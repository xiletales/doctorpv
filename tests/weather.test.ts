import { describe, expect, it, vi } from "vitest";
import { assessPoints, verdictFor } from "../src/lib/ai/assess";
import { pvFeatures, runPvDiagnosis, type PvHourlyRow } from "../src/lib/ai/pipeline";
import { diagnoseClusterWeather, diagnosePv } from "../src/lib/ai/rca";
import { evaluateBattery, evaluateIrradianceSensor, evaluatePv, evaluateWeather, type AlertType } from "../src/lib/alerts/rules";
import { Engine, type WorldSample } from "../src/lib/sim/engine";
import type { Fault } from "../src/lib/sim/faults";
import { clearSky } from "../src/lib/sim/physics";
import { DAY, dayStart } from "../src/lib/sim/time";
import { buildWorld } from "../src/lib/sim/world";
import { OpenMeteoProvider } from "../src/lib/weather/open-meteo";
import { SimulatedWeatherProvider } from "../src/lib/weather/simulated";

const world = buildWorld({ lat: -7.5741, lng: 110.8124 });
const demoDay = 20000;
const today = dayStart(demoDay);
const NOON_ISH = today + 10.25 * 3600;
const FAULT_TYPES: AlertType[] = ["inverter_trip", "production_drop", "sensor_suspect"];
const baseline = (id: string) => world.houses.find((h) => h.id === id)?.pr ?? 0.78;

/** Runs the same assessment the live store uses, and returns the conditions raised for each point. */
function judge(s: WorldSample, stuck: Record<string, number> = {}) {
  const inputs = s.pv.filter((p) => !p.offline).map((p) => ({
    id: p.id, acW: p.acW, panelTempC: p.tempC, capacityKwp: world.houses.find((h) => h.id === p.id)?.capacityKwp ?? 2,
    baselinePr: baseline(p.id), sensorIrradiance: p.sensorIrradiance, sensorStuckTicks: stuck[p.id] ?? 0,
  }));
  const { points, peerRatio } = assessPoints(inputs, s.g);
  const conds = new Map<string, AlertType[]>();
  for (const a of points) {
    const p = s.pv.find((x) => x.id === a.id);
    if (!p) continue;
    const list = evaluatePv({ id: p.id, acW: p.acW, dcV: p.dcV, dcI: p.dcI, inverter: p.inverter, ratio: a.ratio }, a.irradiance, peerRatio) ?? [];
    const sensor = evaluateIrradianceSensor(p.id, a.sensorProblem);
    conds.set(a.id, [...list.map((c) => c.type), ...(sensor ? [sensor.type] : [])]);
  }
  return { conds, points, peerRatio };
}

function sampleAt(faults: Fault[], cloud: number | null, ts = NOON_ISH): WorldSample {
  const engine = new Engine({ world, faults, refDayStart: today, demoDay });
  engine.cloudOverride = cloud;
  engine.warmUp(today - DAY, today);
  return engine.step(ts, 0);
}

const faultsRaised = (conds: Map<string, AlertType[]>) => [...conds.entries()].filter(([, v]) => v.some((t) => FAULT_TYPES.includes(t)));

describe("weather is not a fault", () => {
  it("a 60% drop in output creates no fault alerts, only a weather notice", () => {
    const clear = sampleAt([], null);
    const cloudy = sampleAt([], 0.4);
    const out = (s: WorldSample) => s.pv.reduce((a, p) => a + p.acW, 0);
    expect(out(cloudy) / out(clear)).toBeLessThan(0.45);
    const { conds, peerRatio } = judge(cloudy);
    expect(faultsRaised(conds)).toHaveLength(0);
    const notice = evaluateWeather({ clearFraction: cloudy.g / clearSky(NOON_ISH), clearSkyW: 40000, medianRatio: peerRatio, lowShare: 1 });
    expect(notice?.type).toBe("weather_info");
    expect(notice?.priority).toBe("low");
    expect(notice?.message).toContain("Bukan kerusakan");
  });

  it("a clear day raises no weather notice", () => {
    const s = sampleAt([], null);
    expect(evaluateWeather({ clearFraction: s.g / clearSky(NOON_ISH), clearSkyW: 40000, medianRatio: judge(s).peerRatio, lowShare: 0 })).toBeNull();
  });

  it("a cluster-wide drop is diagnosed as weather, and stays an estimate", () => {
    const d = diagnoseClusterWeather({ clearFraction: 0.4, medianRatio: 1, lowCount: 29, total: 29, sensorIrradiance: 360, referenceIrradiance: 355, referenceLabel: "Cuaca: simulasi" });
    expect(d.causes[0].key).toBe("cuaca");
    expect(d.causes[0].probability).toBeLessThan(1);
    expect(d.causes[0].evidence.length).toBeGreaterThanOrEqual(3);
  });

  it("per-point verdicts separate weather from a fault at the same low output", () => {
    const low = { ratio: 1, irradiance: 350, sensorProblem: null };
    expect(verdictFor(low, 0.4, false, false)).toBe("cuaca");
    expect(verdictFor({ ...low, ratio: 0.6 }, 0.4, true, false)).toBe("gangguan");
    expect(verdictFor(low, 0.95, false, false)).toBe("normal");
    expect(verdictFor({ ...low, irradiance: 40 }, 0.1, false, false)).toBe("belum_dinilai");
    expect(verdictFor({ ...low, sensorProblem: "macet" }, 0.4, false, false)).toBe("sensor");
  });

  it("cloudy day plus one soiled panel flags only that panel", () => {
    const faults: Fault[] = [{ kind: "soiling", assetId: "H07", from: today - 21 * DAY, to: today + DAY, magnitude: 0.68 }];
    const { conds } = judge(sampleAt(faults, 0.4));
    expect(faultsRaised(conds).map(([id]) => id)).toEqual(["H07"]);
    expect(conds.get("H07")).toEqual(["production_drop"]);
  });

  it("the soiled panel is explained as not being the weather", () => {
    const d = diagnosePv({ ratioNow: 0.68, peerRatioNow: 1, irradiance: 350, dcVoltage: 360, dcCurrent: 1, acPowerW: 400, inverterTrip: false, trendPerDay: -0.012, daysDegraded: 15, recurringHours: false, abrupt: false, clearFraction: 0.4 });
    expect(d.causes[0].key).toBe("soiling");
    expect(d.causes.find((c) => c.key === "cuaca")?.probability).toBeLessThan(0.05);
    expect(d.causes[0].evidence.join(" ")).toContain("hari mendung");
  });
});

describe("every fault type is still detected, on clear and cloudy days", () => {
  const cases: { name: string; fault: Fault; expected: AlertType; ts?: number }[] = [
    { name: "inverter trip", fault: { kind: "inverter_trip", assetId: "H05", from: today }, expected: "inverter_trip" },
    { name: "soiling", fault: { kind: "soiling", assetId: "H05", from: today - 21 * DAY, to: today + DAY, magnitude: 0.65 }, expected: "production_drop" },
    { name: "partial shading in its hours", fault: { kind: "shading", assetId: "H05", from: today - 5 * DAY, magnitude: 0.35, hours: [9, 11.5] }, expected: "production_drop" },
    { name: "AC sensor stuck at zero", fault: { kind: "sensor_stuck_zero", assetId: "H05", from: today }, expected: "sensor_suspect" },
    { name: "irradiance sensor stuck far from reality", fault: { kind: "irradiance_stuck", assetId: "H05", from: today, magnitude: 1450 }, expected: "sensor_suspect" },
  ];
  for (const cloud of [null, 0.4]) {
    for (const c of cases) {
      it(`${c.name} under ${cloud === null ? "clear" : "cloudy"} sky`, () => {
        const { conds } = judge(sampleAt([c.fault], cloud));
        expect(conds.get("H05")).toContain(c.expected);
        expect(faultsRaised(conds).map(([id]) => id)).toEqual(["H05"]);
      });
    }
    it(`battery thermal anomaly under ${cloud === null ? "clear" : "cloudy"} sky`, () => {
      const s = sampleAt([{ kind: "thermal", assetId: "B03", from: today - DAY, magnitude: 22 }], cloud);
      const b = s.batteries.find((x) => x.id === "B03");
      expect(b && evaluateBattery(b).map((x) => x.type)).toContain("battery_temp");
    });
    it(`battery cell imbalance under ${cloud === null ? "clear" : "cloudy"} sky`, () => {
      const s = sampleAt([{ kind: "imbalance", assetId: "B05", from: today - 2 * DAY, magnitude: 150 }], cloud);
      const b = s.batteries.find((x) => x.id === "B05");
      expect(b && evaluateBattery(b).map((x) => x.type)).toContain("cell_imbalance");
    });
  }

  it("a stuck irradiance sensor near the true value is caught by the repeat count", () => {
    const s = sampleAt([], null);
    const { conds } = judge(s, { H09: 8 });
    expect(conds.get("H09")).toEqual(["sensor_suspect"]);
  });

  it("a flagged irradiance sensor falls back to the reference, so the panel itself is not blamed", () => {
    const s = sampleAt([{ kind: "irradiance_stuck", assetId: "H05", from: today, magnitude: 1400 }], 0.4);
    const a = judge(s).points.find((p) => p.id === "H05");
    expect(a?.source).toBe("referensi");
    expect(a?.ratio).toBeGreaterThan(0.85);
  });
});

describe("no false alarms over 30 days of varied weather", () => {
  it("healthy assets raise zero fault conditions", () => {
    const engine = new Engine({ world, faults: [], refDayStart: today, demoDay });
    engine.warmUp(today - 35 * DAY, today - 30 * DAY);
    let judged = 0;
    let cloudyJudged = 0;
    const raised: string[] = [];
    for (let t = today - 30 * DAY; t < today; t += 300) {
      const s = engine.step(t, 300);
      for (const b of s.batteries) for (const c of evaluateBattery(b)) raised.push(`${b.id}:${c.type}`);
      if (s.g < 150) continue;
      judged += 1;
      if (s.g / clearSky(t) < 0.7) cloudyJudged += 1;
      for (const [id] of faultsRaised(judge(s).conds)) raised.push(`${id}@${t}`);
    }
    expect(raised).toEqual([]);
    expect(judged).toBeGreaterThan(2000);
    // The test only means something if the period really had cloudy weather in it.
    expect(cloudyJudged).toBeGreaterThan(200);
  });
});

describe("weather providers", () => {
  const body = {
    hourly: { time: ["2026-11-05T10:00"], shortwave_radiation: [800], cloud_cover: [40], temperature_2m: [31] },
    minutely_15: { time: ["2026-11-05T10:00", "2026-11-05T10:15"], shortwave_radiation: [790, 820] },
  };
  const ts = Math.floor(new Date("2026-11-05T10:15:00+07:00").getTime() / 1000);

  it("Open-Meteo prefers the 15-minute value, and caches responses", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(body))) as unknown as typeof fetch;
    const p = new OpenMeteoProvider(-7.57, 110.81, fetchFn);
    const r = await p.current(ts);
    expect(r).toMatchObject({ irradiance: 820, cloudCover: 0.4, ambientC: 31 });
    await p.current(ts);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("Open-Meteo failures return null without throwing", async () => {
    const down = vi.fn(async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    await expect(new OpenMeteoProvider(-7.57, 110.81, down).current(ts)).resolves.toBeNull();
    const bad = vi.fn(async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
    await expect(new OpenMeteoProvider(-7.57, 110.81, bad).current(ts)).resolves.toBeNull();
  });

  it("keeps serving the last good forecast when a refresh fails", async () => {
    let at = 0;
    let up = true;
    const fetchFn = vi.fn(async () => { if (!up) throw new Error("offline"); return new Response(JSON.stringify(body)); }) as unknown as typeof fetch;
    const p = new OpenMeteoProvider(-7.57, 110.81, fetchFn, () => at);
    await p.current(ts);
    up = false;
    at = 60 * 60 * 1000;
    expect((await p.current(ts))?.irradiance).toBe(820);
  });

  it("the simulated provider applies the scenario's cloud factor", async () => {
    let cloud: number | null = null;
    const p = new SimulatedWeatherProvider(() => cloud);
    const clear = await p.current(NOON_ISH);
    cloud = 0.4;
    const cloudy = await p.current(NOON_ISH);
    expect(cloudy.irradiance / clear.irradiance).toBeCloseTo(0.4, 5);
    expect(cloudy.cloudCover).toBeGreaterThan(clear.cloudCover);
  });
});

describe("the diagnosis pipeline accepts a cloudy live reading", () => {
  it("reports weather for a healthy point on a cloudy day", () => {
    const rows: PvHourlyRow[] = [];
    const f = pvFeatures({ capacityKwp: 2, baselinePr: 0.78, rows, weather: new Map(), peersByDay: new Map() }, NOON_ISH, { acW: 500, dcV: 340, dcI: 1.6, inverter: "OK", irradiance: 350, ambientC: 28, peerRatio: 1, clearFraction: 0.4 });
    expect(runPvDiagnosis({ ...f, ratioNow: 1 }).causes[0].key).toBe("cuaca");
  });
});
