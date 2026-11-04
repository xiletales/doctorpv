import "dotenv/config";
import bcrypt from "bcryptjs";
import Database from "better-sqlite3";
import { detectBatteryAnomalies, detectPvAnomalies, type Anomaly, type BatteryDaily } from "../src/lib/ai/anomaly";
import { baselinePr, dailyRatios, withPeers, type HourlyWeather } from "../src/lib/ai/features";
import { expectedPowerW } from "../src/lib/ai/expected";
import { anomalyTitle, MODEL_VERSION, pvFeatures, runBatteryDiagnosis, runPvDiagnosis, type AnomalyPayload, type PvHourlyRow } from "../src/lib/ai/pipeline";
import type { Diagnosis } from "../src/lib/ai/rca";
import { median } from "../src/lib/ai/stats";
import { evaluateBattery, evaluatePv, type AlertType, type Condition } from "../src/lib/alerts/rules";
import { Engine, type WorldSample } from "../src/lib/sim/engine";
import { activeFaults, defaultFaults, indexFaults } from "../src/lib/sim/faults";
import { dayStart, DAY, defaultClock, simNow, wibDay } from "../src/lib/sim/time";
import { buildWorld, envCenter } from "../src/lib/sim/world";

const started = Date.now();
const file = (process.env.DATABASE_URL ?? "file:./data/sunpulse.db").replace(/^file:/, "");
const db = new Database(file);
db.pragma("journal_mode = WAL");
db.pragma("synchronous = OFF");

const realNow = Math.floor(Date.now() / 1000);
const demoDay = wibDay(realNow);
const today = dayStart(demoDay);
const nowTs = simNow(defaultClock(), realNow);
const world = buildWorld(envCenter());
const faults = defaultFaults(today);
const faultIndex = indexFaults(faults);
const engine = new Engine({ world, faults, refDayStart: today, demoDay });
const houseById = new Map(world.houses.map((h) => [h.id, h]));
const battById = new Map(world.batteries.map((b) => [b.id, b]));

db.exec(`
  DELETE FROM User; DELETE FROM Cluster; DELETE FROM SolarSystem; DELETE FROM House; DELETE FROM Battery;
  DELETE FROM Gateway; DELETE FROM Zone; DELETE FROM SolarTelemetry; DELETE FROM BatteryTelemetry;
  DELETE FROM EnergyMeterReading; DELETE FROM WeatherReading; DELETE FROM AiPrediction; DELETE FROM Alert;
  DELETE FROM WorkOrder; DELETE FROM AuditLog; DELETE FROM Setting;
`);

const hash = bcrypt.hashSync("demo1234", 10);
const insZone = db.prepare("INSERT INTO Zone (id,name,code,boundaryGeoJson,roadGeoJson) VALUES (?,?,?,?,?)");
const insUser = db.prepare("INSERT INTO User (id,name,email,passwordHash,role,active,createdAt,houseId) VALUES (?,?,?,?,?,1,?,?)");
const insSolarT = db.prepare("INSERT INTO SolarTelemetry (assetId,res,ts,dcVoltage,dcCurrent,acPowerW,energyWh,panelTempC,inverter,quality) VALUES (?,?,?,?,?,?,?,?,?,0)");
const insBattT = db.prepare("INSERT INTO BatteryTelemetry (assetId,res,ts,voltage,currentA,soc,soh,tempC,spreadMv,cycles,bms,quality) VALUES (?,?,?,?,?,?,?,?,?,?,?,0)");
const insMeter = db.prepare("INSERT INTO EnergyMeterReading (scopeId,res,ts,pvW,loadW,plnImportW,chargeW,dischargeW,curtailW) VALUES (?,?,?,?,?,?,?,?,?)");
const insWeather = db.prepare("INSERT INTO WeatherReading (res,ts,irradiance,ambientC,cloudCover) VALUES (?,?,?,?,?)");
const insPred = db.prepare("INSERT INTO AiPrediction (id,assetType,assetId,zoneId,kind,payloadJson,confidence,modelVersion,alertId,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?)");
const insAlert = db.prepare("INSERT INTO Alert (id,assetType,assetId,zoneId,type,priority,message,recommendedAction,status,createdAt,acknowledgedBy,acknowledgedAt,resolvedAt,workOrderId) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)");

// Hourly accumulators, flushed on each hour boundary.
interface Acc { n: number; a: number; b: number; c: number; d: number; e: number; f: number; last: string }
const pvAcc = new Map<string, Acc>();
const bAcc = new Map<string, Acc>();
const gAcc = new Map<string, number[]>();
let wAcc = { n: 0, g: 0, t: 0 };
const pvRows = new Map<string, PvHourlyRow[]>(world.houses.map((h) => [h.id, []]));
const weather = new Map<number, HourlyWeather>();
const battDaily = new Map<string, Map<number, BatteryDaily>>(world.batteries.map((b) => [b.id, new Map()]));
let snapshot: WorldSample | null = null;

function flushHour(hourTs: number) {
  for (const [id, a] of pvAcc) {
    if (a.n === 0) continue;
    const ac = a.a / a.n;
    insSolarT.run(id, 60, hourTs, a.b / a.n, a.c / a.n, ac, ac, a.d / a.n, a.last);
    pvRows.get(id)?.push({ ts: hourTs, acW: ac, dcV: a.b / a.n, dcI: a.c / a.n, inverter: a.last });
  }
  for (const [id, a] of bAcc) {
    if (a.n === 0) continue;
    insBattT.run(id, 60, hourTs, a.a / a.n, a.b / a.n, a.c / a.n, a.d, a.e, a.f, a.a === 0 ? 0 : a.b === 0 ? 0 : cyclesOf(id, hourTs), a.last);
  }
  for (const [id, v] of gAcc) {
    const n = v[6];
    insMeter.run(id, 60, hourTs, v[0] / n, v[1] / n, v[2] / n, v[3] / n, v[4] / n, v[5] / n);
  }
  const g = wAcc.g / Math.max(wAcc.n, 1);
  const t = wAcc.t / Math.max(wAcc.n, 1);
  insWeather.run(60, hourTs, g, t, 0);
  weather.set(hourTs, { ts: hourTs, irradiance: g, ambientC: t });
  pvAcc.clear();
  bAcc.clear();
  gAcc.clear();
  wAcc = { n: 0, g: 0, t: 0 };
}

function cyclesOf(id: string, ts: number): number {
  const b = battById.get(id);
  return b ? (b.ageDays + (ts - today) / DAY) * 0.85 : 0;
}

const start = today - 30 * DAY;
const end = today + DAY;
const fiveMinFrom = today - DAY;
const snapTs = Math.floor(nowTs / 300) * 300;

engine.warmUp(start - 5 * DAY, start);
const seedTelemetry = db.transaction(() => {
  let hour = start;
  for (let t = start; t < end; t += 300) {
    if (t >= hour + 3600) {
      flushHour(hour);
      hour += 3600;
    }
    const s = engine.step(t, 300);
    if (t === snapTs) snapshot = s;
    const keep = t >= fiveMinFrom;
    if (keep) insWeather.run(5, t, s.g, s.ambient, 0);
    wAcc.n += 1;
    wAcc.g += s.g;
    wAcc.t += s.ambient;

    for (const p of s.pv) {
      if (p.offline) continue;
      if (keep) insSolarT.run(p.id, 5, t, p.dcV, p.dcI, p.acW, (p.acW * 300) / 3600, p.tempC, p.inverter);
      const a = pvAcc.get(p.id) ?? { n: 0, a: 0, b: 0, c: 0, d: 0, e: 0, f: 0, last: "OK" };
      a.n += 1; a.a += p.acW; a.b += p.dcV; a.c += p.dcI; a.d += p.tempC; a.last = p.inverter;
      pvAcc.set(p.id, a);
    }
    for (const b of s.batteries) {
      if (keep) insBattT.run(b.id, 5, t, b.voltage, b.currentA, b.soc, b.soh, b.tempC, b.spreadMv, b.cycles, b.bms);
      const a = bAcc.get(b.id) ?? { n: 0, a: 0, b: 0, c: 0, d: 0, e: 0, f: 0, last: "OK" };
      a.n += 1; a.a += b.voltage; a.b += b.currentA; a.c += b.soc; a.d = b.soh; a.e = Math.max(a.e, b.tempC); a.f = Math.max(a.f, b.spreadMv); a.last = b.bms;
      bAcc.set(b.id, a);
      if (t <= nowTs) {
        const day = wibDay(t);
        const bd = battDaily.get(b.id);
        const row = bd?.get(day) ?? { ts: dayStart(day), maxTempC: 0, maxSpreadMv: 0, peerMaxTempC: 0 };
        row.maxTempC = Math.max(row.maxTempC, b.tempC);
        row.maxSpreadMv = Math.max(row.maxSpreadMv, b.spreadMv);
        bd?.set(day, row);
      }
    }
    const rt = { pvW: 0, loadW: 0, plnW: 0, chargeW: 0, dischargeW: 0, curtailW: 0 };
    const addG = (id: string, m: typeof rt) => {
      if (keep) insMeter.run(id, 5, t, m.pvW, m.loadW, m.plnW, m.chargeW, m.dischargeW, m.curtailW);
      const v = gAcc.get(id) ?? [0, 0, 0, 0, 0, 0, 0];
      v[0] += m.pvW; v[1] += m.loadW; v[2] += m.plnW; v[3] += m.chargeW; v[4] += m.dischargeW; v[5] += m.curtailW; v[6] += 1;
      gAcc.set(id, v);
    };
    for (const g of s.zones) {
      addG(g.id, g);
      rt.pvW += g.pvW; rt.loadW += g.loadW; rt.plnW += g.plnW; rt.chargeW += g.chargeW; rt.dischargeW += g.dischargeW; rt.curtailW += g.curtailW;
    }
    addG("CLUSTER", rt);
  }
  flushHour(hour);
});

// Baseline PR must exist before registry rows are written.
const baselines = new Map<string, number>();
const seedStatic = db.transaction(() => {
  for (const g of world.zones) {
    insZone.run(g.id, g.name, g.code, JSON.stringify(g.boundary), JSON.stringify({ road: g.road, label: [g.labelLng, g.labelLat] }));
  }
  db.prepare("INSERT INTO Cluster (id,name,boundaryGeoJson) VALUES (?,?,?)").run("KLASTER-1", "Klaster Permukiman", JSON.stringify(world.boundary));
  const owner = world.houses[0];
  insUser.run("U-DLH", "Ratna Wibowo", "dlh@sunpulse.id", hash, "dlh", realNow, null);
  insUser.run("U-ADM", "Agus Santoso", "admin@sunpulse.id", hash, "admin", realNow, null);
  insUser.run("U-T1", "Budi Hartono", "teknisi1@sunpulse.id", hash, "teknisi", realNow, null);
  insUser.run("U-W1", owner.ownerName, "warga.h01@sunpulse.id", hash, "warga", realNow, owner.id);

  const insHouse = db.prepare("INSERT INTO House (id,zoneId,ownerCode,ownerName,address,lat,lng,batteryId,gatewayId) VALUES (?,?,?,?,?,?,?,?,?)");
  const insSolar = db.prepare("INSERT INTO SolarSystem (id,houseId,capacityKwp,panelCount,inverterModel,tilt,azimuth,installDate,lat,lng,baselinePr,registryStatus) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)");
  for (const h of world.houses) {
    insHouse.run(h.id, h.zoneId, h.ownerCode, h.ownerName, h.address, h.lat, h.lng, h.batteryId, h.gatewayId);
    insSolar.run(`PV-${h.id}`, h.id, h.capacityKwp, h.panelCount, h.inverterModel, h.tilt, h.azimuth, today - h.ageDays * DAY, h.pvLat, h.pvLng, baselines.get(h.id) ?? h.pr, h.registryStatus);
  }
  const insBatt = db.prepare("INSERT INTO Battery (id,zoneId,chemistry,nominalCapacityKwh,nominalVoltage,installDate,lat,lng) VALUES (?,?,'LiFePO4',?,?,?,?,?)");
  for (const b of world.batteries) insBatt.run(b.id, b.zoneId, b.capacityKwh, b.nominalV, today - b.ageDays * DAY, b.lat, b.lng);
  const insGw = db.prepare("INSERT INTO Gateway (id,zoneId,firmware,lat,lng) VALUES (?,?,?,?,?)");
  for (const g of world.gateways) insGw.run(g.id, g.zoneId, g.firmware, g.lat, g.lng);
  db.prepare("INSERT INTO Setting (key,valueJson) VALUES ('seedDay',?)").run(String(demoDay));
});

seedTelemetry();

// Baseline comes from history before today, as the median day keeps fault periods out.
for (const h of world.houses) {
  const rows = (pvRows.get(h.id) ?? []).filter((r) => r.ts < today);
  baselines.set(h.id, baselinePr(rows, weather, h.capacityKwp));
}
seedStatic();

// Anomaly detection over the seeded history, using the same engine code as live analysis.
const visibleRows = new Map<string, PvHourlyRow[]>();
for (const [id, rows] of pvRows) visibleRows.set(id, rows.filter((r) => r.ts <= nowTs));
const peersByDay = new Map<string, Map<number, number[]>>();
const ratiosByHouse = new Map<string, ReturnType<typeof dailyRatios>>();
for (const h of world.houses) {
  const ratios = dailyRatios(visibleRows.get(h.id) ?? [], weather, h.capacityKwp, baselines.get(h.id) ?? h.pr);
  ratiosByHouse.set(h.id, ratios);
  const zoneMap = peersByDay.get("ALL") ?? new Map<number, number[]>();
  for (const d of ratios) {
    const list = zoneMap.get(d.day) ?? [];
    list.push(d.ratio);
    zoneMap.set(d.day, list);
  }
  peersByDay.set("ALL", zoneMap);
}

interface Found {
  assetType: "pv" | "battery";
  assetId: string;
  zoneId: string;
  anomaly: Anomaly;
  diagnosis: Diagnosis | null;
}
const found: Found[] = [];
for (const h of world.houses) {
  const peers = peersByDay.get("ALL") ?? new Map<number, number[]>();
  const points = withPeers(ratiosByHouse.get(h.id) ?? [], peers);
  for (const anomaly of detectPvAnomalies(points)) {
    const f = pvFeatures(
      { capacityKwp: h.capacityKwp, baselinePr: baselines.get(h.id) ?? h.pr, rows: pvRows.get(h.id) ?? [], weather, peersByDay: peers },
      Math.min(anomaly.to + 10 * 3600, nowTs),
    );
    const diagnosis = runPvDiagnosis(f);
    const top = diagnosis.causes[0].key;
    // A suspected sensor is reported as needing verification, never as a failed PV system.
    const shaped: Anomaly = top === "sensor" ? { ...anomaly, pattern: "sensor", severity: "medium" } : top === "inverter" ? { ...anomaly, pattern: "sudden_zero" } : top === "shading" ? { ...anomaly, pattern: "partial" } : anomaly;
    found.push({ assetType: "pv", assetId: h.id, zoneId: h.zoneId, anomaly: shaped, diagnosis });
  }
}
for (const b of world.batteries) {
  const mine = [...(battDaily.get(b.id)?.entries() ?? [])].sort((x, y) => x[0] - y[0]);
  const siblings = world.batteries.filter((o) => o.id !== b.id);
  const days = mine.map(([day, row]) => ({
    ...row,
    peerMaxTempC: median(siblings.map((o) => battDaily.get(o.id)?.get(day)?.maxTempC ?? row.maxTempC)),
  }));
  for (const anomaly of detectBatteryAnomalies(days)) {
    const last = days.find((d) => d.ts >= anomaly.from) ?? days[days.length - 1];
    const diagnosis = runBatteryDiagnosis({
      tempC: last.maxTempC,
      ambientC: 30,
      peerTempC: last.peerMaxTempC,
      tempRisePerMin: 0,
      currentA: 10,
      spreadMv: last.maxSpreadMv,
      soh: b.sohRef,
      bmsAlarm: anomaly.pattern === "thermal",
      implausibleSteps: false,
    });
    found.push({ assetType: "battery", assetId: b.id, zoneId: b.zoneId, anomaly, diagnosis });
  }
}

const TYPE_BY_CAUSE: Record<string, AlertType> = {
  inverter: "inverter_trip",
  wiring: "inverter_trip",
  sensor: "sensor_suspect",
  soiling: "production_drop",
  shading: "production_drop",
  thermal: "battery_temp",
  imbalance: "cell_imbalance",
  aging: "soh_degradation",
};

const seedAlerts = db.transaction(() => {
  // Open alerts come from the live rules at the seeded instant, so the live engine finds them already open.
  const sample = snapshot;
  const open = new Map<string, { assetType: "pv" | "battery"; zoneId: string; condition: Condition; from: number }>();
  if (sample) {
    for (const p of sample.pv) {
      if (p.offline) continue;
      const h = houseById.get(p.id);
      if (!h) continue;
      const exp = expectedPowerW(h.capacityKwp, sample.g, sample.ambient, baselines.get(h.id) ?? h.pr);
      const conds = evaluatePv({ id: p.id, acW: p.acW, dcV: p.dcV, dcI: p.dcI, inverter: p.inverter, ratio: exp > 0 ? p.acW / exp : 1 }, sample.g) ?? [];
      for (const c of conds) {
        const f = activeFaults(faultIndex, p.id, sample.ts)[0];
        open.set(`${p.id}:${c.type}`, { assetType: "pv", zoneId: h.zoneId, condition: c, from: f?.from ?? sample.ts - 3600 });
      }
    }
    for (const b of sample.batteries) {
      for (const c of evaluateBattery(b)) {
        const f = activeFaults(faultIndex, b.id, sample.ts)[0];
        open.set(`${b.id}:${c.type}`, { assetType: "battery", zoneId: b.zoneId, condition: c, from: f?.from ?? today - 3 * DAY });
      }
    }
  }
  const off = faults.find((f) => f.kind === "device_offline");
  if (off) {
    const h = houseById.get(off.assetId);
    if (h) {
      open.set(`${h.id}:device_offline`, {
        assetType: "pv",
        zoneId: h.zoneId,
        from: off.from,
        condition: {
          type: "device_offline",
          priority: "low",
          message: `Sensor PV ${h.id} tidak mengirim data.`,
          recommendedAction: "Periksa daya dan koneksi sensor pada kunjungan berikutnya.",
        },
      });
    }
  }

  let n = 0;
  const openIds = new Map<string, string>();
  for (const [key, a] of open) {
    n += 1;
    const id = `SEED-${String(n).padStart(3, "0")}`;
    const [assetId] = key.split(":");
    openIds.set(key, id);
    // An alert opens during the working day when analysis first catches the fault, not when the fault physically began.
    const detected = found.find((f) => f.assetId === assetId && f.anomaly.to >= today - DAY);
    const sudden = a.condition.type === "inverter_trip" || a.condition.type === "device_offline";
    const raisedAt = sudden ? a.from : (detected?.anomaly.from ?? today - 3 * DAY) + (8.4 + n * 0.35) * 3600;
    a.from = raisedAt;
    insAlert.run(id, a.assetType, assetId, a.zoneId, a.condition.type, a.condition.priority, a.condition.message, a.condition.recommendedAction, "open", raisedAt, null, null, null);
  }

  let pn = 0;
  const usedOpen = new Set<string>();
  for (const f of found) {
    pn += 1;
    const ongoing = f.anomaly.to >= today - DAY;
    const topCause = f.diagnosis?.causes[0]?.key ?? "";
    const type = TYPE_BY_CAUSE[topCause] ?? "production_drop";
    const matchKey = [...open.keys()].find((k) => k.startsWith(`${f.assetId}:`));
    let alertId: string | null = null;
    if (ongoing && matchKey) {
      alertId = openIds.get(matchKey) ?? null;
      usedOpen.add(matchKey);
    } else {
      alertId = `HIST-${String(pn).padStart(3, "0")}`;
      const priority = f.anomaly.severity;
      const closed = f.anomaly.to + DAY;
      insAlert.run(alertId, f.assetType, f.assetId, f.zoneId, type, priority, `${anomalyTitle(f.anomaly.pattern)} pada ${f.assetId}.`, f.diagnosis?.causes[0]?.action ?? "Periksa aset.", "resolved", f.anomaly.from + 8 * 3600, "Budi Hartono", f.anomaly.from + 8 * 3600 + 1800 + (pn % 5) * 900, Math.min(closed, nowTs - 3600));
    }
    const openPriority = ongoing && matchKey ? open.get(matchKey)?.condition.priority : undefined;
    const openedAt = ongoing && matchKey ? open.get(matchKey)?.from : undefined;
    const payload: AnomalyPayload = { ...f.anomaly, from: openedAt ?? f.anomaly.from, severity: openPriority ?? f.anomaly.severity, title: anomalyTitle(f.anomaly.pattern), open: Boolean(ongoing && matchKey), diagnosis: f.diagnosis };
    insPred.run(`ANM-${String(pn).padStart(3, "0")}`, f.assetType, f.assetId, f.zoneId, "anomaly", JSON.stringify(payload), f.diagnosis?.confidence ?? 0.5, MODEL_VERSION, alertId, f.anomaly.from);
  }

  // Open alerts that daily analysis cannot see, such as SoH past threshold, still receive a diagnosis.
  for (const [key, a] of open) {
    if (usedOpen.has(key)) continue;
    const [assetId] = key.split(":");
    pn += 1;
    let diagnosis: Diagnosis | null = null;
    let pattern: Anomaly["pattern"] = "sensor";
    let metric = "connection";
    if (a.condition.type === "soh_degradation") {
      const b = battById.get(assetId);
      pattern = "aging";
      metric = "soh";
      diagnosis = runBatteryDiagnosis({ tempC: 33, ambientC: 30, peerTempC: 33, tempRisePerMin: 0, currentA: 5, spreadMv: 30, soh: b?.sohRef ?? 78, bmsAlarm: false, implausibleSteps: false });
    } else if (a.condition.type === "cell_imbalance") {
      const b = battById.get(assetId);
      pattern = "imbalance";
      metric = "spreadMv";
      diagnosis = runBatteryDiagnosis({ tempC: 33, ambientC: 30, peerTempC: 33, tempRisePerMin: 0, currentA: 5, spreadMv: 180, soh: b?.sohRef ?? 85, bmsAlarm: false, implausibleSteps: false });
    }
    const payload: AnomalyPayload = {
      metric,
      methods: ["threshold"],
      from: a.from,
      to: nowTs,
      deviationPct: 0,
      severity: a.condition.priority,
      pattern,
      title: a.condition.type === "device_offline" ? "Sensor tidak mengirim data" : anomalyTitle(pattern),
      open: true,
      diagnosis,
    };
    insPred.run(`ANM-${String(pn).padStart(3, "0")}`, a.assetType, assetId, a.zoneId, "anomaly", JSON.stringify(payload), diagnosis?.confidence ?? 0.5, MODEL_VERSION, openIds.get(key) ?? null, a.from);
  }
  return { open: [...open.keys()], anomalies: pn };
});

const result = seedAlerts();
db.pragma("wal_checkpoint(TRUNCATE)");
const count = (t: string) => (db.prepare(`SELECT count(*) c FROM ${t}`).get() as { c: number }).c;
console.log(`Seeded in ${((Date.now() - started) / 1000).toFixed(1)}s:`, {
  solar: count("SolarTelemetry"),
  battery: count("BatteryTelemetry"),
  meter: count("EnergyMeterReading"),
  anomalies: result.anomalies,
  openAlerts: result.open,
});
db.close();
