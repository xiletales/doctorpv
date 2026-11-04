import { beforeAll, describe, expect, it } from "vitest";
import { detectBatteryAnomalies, detectPvAnomalies, detectStuck, type BatteryDaily } from "../src/lib/ai/anomaly";
import { baselinePr, dailyRatios, withPeers, type HourlyWeather } from "../src/lib/ai/features";
import { forecastSoh } from "../src/lib/ai/forecast";
import { pvFeatures, runBatteryDiagnosis, runPvDiagnosis, type PvHourlyRow } from "../src/lib/ai/pipeline";
import { median, robustZ } from "../src/lib/ai/stats";
import { evaluatePv } from "../src/lib/alerts/rules";
import { Engine } from "../src/lib/sim/engine";
import type { Fault } from "../src/lib/sim/faults";
import { DAY, dayStart, wibDay } from "../src/lib/sim/time";
import { buildWorld } from "../src/lib/sim/world";

/** Runs the real physics engine with injected faults, so detection is tested on full-system data. */
const world = buildWorld({ lat: -6.9, lng: 107.6 });
const demoDay = 20000;
const today = dayStart(demoDay);
const G = "G1";
const house = (i: number) => world.houses.filter((h) => h.gangId === G)[i];

interface Run {
  rows: Map<string, PvHourlyRow[]>;
  weather: Map<number, HourlyWeather>;
  batteries: Map<string, BatteryDaily[]>;
}

function simulate(faults: Fault[]): Run {
  const engine = new Engine({ world, faults, refDayStart: today, demoDay });
  const start = today - 30 * DAY;
  const rows = new Map<string, PvHourlyRow[]>();
  const weather = new Map<number, HourlyWeather>();
  const batteries = new Map<string, Map<number, BatteryDaily>>();
  for (let hour = start; hour < today; hour += 3600) {
    const acc = new Map<string, { w: number; v: number; i: number; inv: string }>();
    let g = 0;
    let amb = 0;
    for (let t = hour; t < hour + 3600; t += 900) {
      const s = engine.step(t, 900);
      g += s.g / 4;
      amb += s.ambient / 4;
      for (const p of s.pv) {
        if (p.gangId !== G) continue;
        const a = acc.get(p.id) ?? { w: 0, v: 0, i: 0, inv: "OK" };
        a.w += p.acW / 4; a.v += p.dcV / 4; a.i += p.dcI / 4; a.inv = p.inverter;
        acc.set(p.id, a);
      }
      for (const b of s.batteries) {
        if (b.gangId !== G) continue;
        const day = wibDay(t);
        const m = batteries.get(b.id) ?? new Map<number, BatteryDaily>();
        const row = m.get(day) ?? { ts: dayStart(day), maxTempC: 0, maxSpreadMv: 0, peerMaxTempC: 0 };
        row.maxTempC = Math.max(row.maxTempC, b.tempC);
        row.maxSpreadMv = Math.max(row.maxSpreadMv, b.spreadMv);
        m.set(day, row);
        batteries.set(b.id, m);
      }
    }
    weather.set(hour, { ts: hour, irradiance: g, ambientC: amb });
    for (const [id, a] of acc) {
      const list = rows.get(id) ?? [];
      list.push({ ts: hour, acW: a.w, dcV: a.v, dcI: a.i, inverter: a.inv });
      rows.set(id, list);
    }
  }
  return {
    rows,
    weather,
    batteries: new Map([...batteries].map(([id, m]) => [id, [...m.values()].sort((a, b) => a.ts - b.ts)])),
  };
}

function analysePv(run: Run, id: string) {
  const def = world.houses.find((h) => h.id === id)!;
  const peersByDay = new Map<number, number[]>();
  const pr = new Map<string, number>();
  for (const h of world.houses.filter((x) => x.gangId === G)) {
    const rows = run.rows.get(h.id) ?? [];
    const base = baselinePr(rows, run.weather, h.capacityKwp);
    pr.set(h.id, base);
    for (const d of dailyRatios(rows, run.weather, h.capacityKwp, base)) {
      const l = peersByDay.get(d.day) ?? [];
      l.push(d.ratio);
      peersByDay.set(d.day, l);
    }
  }
  const own = dailyRatios(run.rows.get(id) ?? [], run.weather, def.capacityKwp, pr.get(id) ?? 0.78);
  const anomalies = detectPvAnomalies(withPeers(own, peersByDay));
  const at = anomalies.length ? anomalies[anomalies.length - 1].to + 10 * 3600 : today;
  const features = pvFeatures({ capacityKwp: def.capacityKwp, baselinePr: pr.get(id) ?? 0.78, rows: run.rows.get(id) ?? [], weather: run.weather, peersByDay }, at);
  return { anomalies, diagnosis: runPvDiagnosis(features) };
}

function analyseBattery(run: Run, id: string) {
  const mine = run.batteries.get(id) ?? [];
  const peers = [...run.batteries.entries()].filter(([k]) => k !== id).map(([, v]) => v);
  return detectBatteryAnomalies(
    mine.map((d, i) => ({ ...d, peerMaxTempC: median(peers.map((p) => p[i]?.maxTempC ?? d.maxTempC)) })),
  );
}

describe("anomaly detection on injected faults", () => {
  let clean: Run;
  beforeAll(() => {
    clean = simulate([]);
  });

  it("raises nothing on a healthy gang", () => {
    for (let i = 0; i < 20; i++) expect(analysePv(clean, house(i).id).anomalies).toHaveLength(0);
    for (const id of clean.batteries.keys()) expect(analyseBattery(clean, id)).toHaveLength(0);
  });

  it("detects and diagnoses an inverter trip", () => {
    const id = house(2).id;
    const r = analysePv(simulate([{ kind: "inverter_trip", assetId: id, from: today - 6 * DAY, to: today - 3 * DAY }]), id);
    expect(r.anomalies).toHaveLength(1);
    expect(r.anomalies[0].severity).toBe("critical");
    expect(r.diagnosis.causes[0].key).toBe("inverter");
  });

  it("detects and diagnoses gradual soiling", () => {
    const id = house(3).id;
    const r = analysePv(simulate([{ kind: "soiling", assetId: id, from: today - 22 * DAY, magnitude: 0.65 }]), id);
    expect(r.anomalies.length).toBeGreaterThan(0);
    expect(r.anomalies[r.anomalies.length - 1].pattern).toBe("gradual");
    expect(r.diagnosis.causes[0].key).toBe("soiling");
  });

  it("detects recurring partial shading and diagnoses it from the hours affected", () => {
    const id = house(4).id;
    const r = analysePv(simulate([{ kind: "shading", assetId: id, from: today - 10 * DAY, magnitude: 0.15, hours: [10.5, 13.5] }]), id);
    expect(r.anomalies.length).toBeGreaterThan(0);
    expect(r.diagnosis.causes[0].key).toBe("shading");
  });

  it("flags a stuck-at-zero sensor as a sensor issue, not as PV failure", () => {
    const id = house(5).id;
    const r = analysePv(simulate([{ kind: "sensor_stuck_zero", assetId: id, from: today - 5 * DAY, to: today - 3 * DAY }]), id);
    expect(r.anomalies.length).toBeGreaterThan(0);
    expect(r.diagnosis.causes[0].key).toBe("sensor");
  });

  it("detects a battery thermal anomaly", () => {
    const id = "B003";
    const a = analyseBattery(simulate([{ kind: "thermal", assetId: id, from: today - 8 * DAY, to: today - 7 * DAY, magnitude: 15 }]), id);
    expect(a.map((x) => x.pattern)).toContain("thermal");
  });

  it("detects battery cell imbalance", () => {
    const id = "B005";
    const a = analyseBattery(simulate([{ kind: "imbalance", assetId: id, from: today - 10 * DAY, to: today - 6 * DAY, magnitude: 150 }]), id);
    expect(a.map((x) => x.pattern)).toContain("imbalance");
  });
});

describe("supporting analytics", () => {
  it("robust z-score ignores outliers already in the history", () => {
    const history = [1, 1.01, 0.99, 1, 1.02, 0.98, 9];
    expect(Math.abs(robustZ(1, history))).toBeLessThan(1);
    expect(robustZ(9, history)).toBeGreaterThan(3);
  });

  it("finds stuck runs only while the signal should be active", () => {
    const values = [0, 0, 0, 5, 7, 7, 7, 7, 3, 0, 0, 0];
    const active = [false, false, false, true, true, true, true, true, true, false, false, false];
    const runs = detectStuck(values, active);
    expect(runs).toEqual([{ start: 4, length: 4, value: 7 }]);
  });

  it("alert rules separate a trip from a sensor fault using DC power", () => {
    const trip = evaluatePv({ id: "H1", acW: 0, dcV: 400, dcI: 0, inverter: "TRIP", ratio: 0 }, 700);
    const sensor = evaluatePv({ id: "H1", acW: 0, dcV: 400, dcI: 5, inverter: "OK", ratio: 0 }, 700);
    expect(trip?.[0].type).toBe("inverter_trip");
    expect(sensor?.[0].type).toBe("sensor_suspect");
    expect(evaluatePv({ id: "H1", acW: 0, dcV: 0, dcI: 0, inverter: "IDLE", ratio: 1 }, 20)).toBeNull();
  });

  it("battery diagnosis follows the evidence", () => {
    const base = { tempC: 33, ambientC: 30, peerTempC: 33, tempRisePerMin: 0, currentA: 5, spreadMv: 30, soh: 92, bmsAlarm: false, implausibleSteps: false };
    expect(runBatteryDiagnosis({ ...base, tempC: 58, tempRisePerMin: 30, bmsAlarm: true }).causes[0].key).toBe("thermal");
    expect(runBatteryDiagnosis({ ...base, spreadMv: 170 }).causes[0].key).toBe("imbalance");
    expect(runBatteryDiagnosis({ ...base, soh: 76 }).causes[0].key).toBe("aging");
    const total = runBatteryDiagnosis(base).causes.reduce((a, c) => a + c.probability, 0);
    expect(total).toBeCloseTo(1, 5);
  });

  it("SoH forecast falls, widens with distance, and handles batteries past end of life", () => {
    const hist = Array.from({ length: 30 }, (_, i) => ({ ts: i * DAY, soh: 90 - i * 0.03 + (i % 2 ? 0.04 : -0.04) }));
    const f = forecastSoh(hist);
    expect(f.slopePerDay).toBeLessThan(0);
    expect(f.daysToEol).toBeGreaterThan(200);
    const first = f.projection[0];
    const last = f.projection[f.projection.length - 1];
    expect(last.upper - last.lower).toBeGreaterThan(first.upper - first.lower);
    const past = forecastSoh(hist.map((h) => ({ ...h, soh: h.soh - 12 })));
    expect(past.pastEol).toBe(true);
    expect(past.daysToEol).toBeNull();
  });
});
