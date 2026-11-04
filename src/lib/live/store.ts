import { prisma } from "../db";
import { batteryHealth, FAULT_WEIGHT, pvHealth, type HealthScore } from "../ai/health";
import { MODEL_VERSION, pvFeatures, runBatteryDiagnosis, runPvDiagnosis, anomalyTitle, type AnomalyPayload, type PvHourlyRow } from "../ai/pipeline";
import type { Anomaly } from "../ai/anomaly";
import type { HourlyWeather } from "../ai/features";
import { dailyRatios } from "../ai/features";
import { expectedPowerW } from "../ai/expected";
import { median } from "../ai/stats";
import { evaluateBattery, evaluatePv, type AlertType, type Condition } from "../alerts/rules";
import { telemetryMessage, type ScenarioName, type SimDirective, type TelemetryMessage } from "../contracts/telemetry";
import { dayStart, DAY, defaultClock, simNow, wibDay, type ClockConfig } from "../sim/time";
import type { AlertPriority, AssetStatus, SessionUser } from "../types";
import { gangScope } from "../rbac";

export interface PvLive {
  id: string;
  gangId: string;
  acW: number;
  dcV: number;
  dcI: number;
  tempC: number;
  inverter: string;
  rssi: number;
  expectedW: number;
  ratio: number;
  todayKwh: number;
  capacityKwp: number;
  status: AssetStatus;
  health: number;
}

export interface BatteryLive {
  id: string;
  gangId: string;
  voltage: number;
  currentA: number;
  soc: number;
  soh: number;
  tempC: number;
  spreadMv: number;
  cycles: number;
  bms: string;
  rssi: number;
  status: AssetStatus;
  health: number;
}

export interface GangLive {
  id: string;
  pvW: number;
  loadW: number;
  plnW: number;
  chargeW: number;
  dischargeW: number;
  curtailW: number;
  avgSoc: number;
  irradiance: number;
  ambientC: number;
  status: AssetStatus;
  critical: number;
  warning: number;
  todayKwh: number;
}

export interface GatewayLive {
  id: string;
  gangId: string;
  online: boolean;
  lastSeen: number;
  bufferEstimate: number;
  lastSyncCount: number;
}

export interface LiveSnapshot {
  simTs: number;
  clock: ClockConfig;
  simulatorConnected: boolean;
  pv: PvLive[];
  batteries: BatteryLive[];
  gangs: GangLive[];
  gateways: GatewayLive[];
  openAlerts: number;
  directive: SimDirective;
  quality: { accepted: number; rejected: number; duplicates: number; buffered: number };
}

export interface AlertEvent {
  kind: "new" | "upgraded" | "resolved" | "sync" | "reset";
  id?: string;
  assetId?: string;
  gangId?: string;
  priority?: AlertPriority;
  message?: string;
  recommendedAction?: string;
  count?: number;
}

interface OpenAlert {
  id: string;
  assetId: string;
  assetType: string;
  gangId: string;
  type: AlertType;
  priority: AlertPriority;
}

interface Subscriber {
  user: SessionUser;
  send: (event: string, data: unknown) => void;
}

export interface RingPoint {
  t: number;
  a: number;
  b: number;
}

const RING = 90;
const OFFLINE_AFTER = 7;
const PV_TYPES: AlertType[] = ["inverter_trip", "production_drop", "sensor_suspect"];
const BATT_TYPES: AlertType[] = ["battery_temp", "cell_imbalance", "low_soc", "soh_degradation"];

const realNow = () => Math.floor(Date.now() / 1000);
const parseTs = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

class LiveStore {
  clock: ClockConfig = defaultClock();
  directive: SimDirective = { clock: this.clock, inverterH021: false, batteryB025: false, gw3Offline: false, resetEpoch: 0 };
  pv = new Map<string, PvLive>();
  batteries = new Map<string, BatteryLive>();
  gangs = new Map<string, GangLive>();
  gateways = new Map<string, GatewayLive>();
  rings = new Map<string, RingPoint[]>();
  health = new Map<string, HealthScore>();
  open = new Map<string, OpenAlert>();
  private meta = new Map<string, { capacityKwp: number; baselinePr: number; ageYears: number; maintenance: boolean }>();
  private lastSeen = new Map<string, number>();
  private lastSeq = new Map<string, number>();
  private anomalies = new Map<string, number>();
  private hits = new Map<string, number>();
  private clears = new Map<string, number>();
  private lastBucket = new Map<string, number>();
  private subs = new Set<Subscriber>();
  private queue: Promise<unknown> = Promise.resolve();
  private flushTimer: NodeJS.Timeout | null = null;
  private alertSeq = 0;
  private ready: Promise<void> | null = null;
  private lastAnyMessage = 0;
  private offlineSince = new Map<string, number>();
  quality = { accepted: 0, rejected: 0, duplicates: 0, buffered: 0 };
  quarantine: { at: number; reason: string }[] = [];

  init(): Promise<void> {
    this.ready ??= this.load();
    return this.ready;
  }

  private async load(): Promise<void> {
    const now = simNow(this.clock);
    const bucket = Math.floor(now / 300) * 300;
    const today = dayStart(wibDay(now));
    const [solar, batts, gws, alerts, preds, solarNow, battNow, meterNow, weatherNow, todayEnergy, gangToday] = await Promise.all([
      prisma.solarSystem.findMany({ include: { house: true } }),
      prisma.battery.findMany(),
      prisma.gateway.findMany(),
      prisma.alert.findMany({ where: { status: { not: "resolved" } } }),
      prisma.aiPrediction.findMany({ where: { kind: "anomaly" }, select: { assetId: true } }),
      prisma.solarTelemetry.findMany({ where: { res: 5, ts: { lte: bucket, gte: bucket - 2 * DAY } }, orderBy: { ts: "desc" }, distinct: ["assetId"] }),
      prisma.batteryTelemetry.findMany({ where: { res: 5, ts: bucket } }),
      prisma.energyMeterReading.findMany({ where: { res: 5, ts: bucket } }),
      prisma.weatherReading.findFirst({ where: { res: 5, ts: bucket } }),
      prisma.solarTelemetry.groupBy({ by: ["assetId"], where: { res: 5, ts: { gte: today, lte: now } }, _sum: { energyWh: true } }),
      prisma.energyMeterReading.groupBy({ by: ["scopeId"], where: { res: 5, ts: { gte: today, lte: now } }, _sum: { pvW: true } }),
    ]);
    const sNow = new Map(solarNow.map((r) => [r.assetId, r]));
    const bNow = new Map(battNow.map((r) => [r.assetId, r]));
    const mNow = new Map(meterNow.map((r) => [r.scopeId, r]));
    const eToday = new Map(todayEnergy.map((r) => [r.assetId, (r._sum.energyWh ?? 0) / 1000]));
    const g = weatherNow?.irradiance ?? 0;
    const amb = weatherNow?.ambientC ?? 28;

    this.open.clear();
    for (const a of alerts) {
      this.open.set(`${a.assetId}:${a.type}`, {
        id: a.id, assetId: a.assetId, assetType: a.assetType, gangId: a.gangId,
        type: a.type as AlertType, priority: a.priority as AlertPriority,
      });
    }
    this.anomalies.clear();
    for (const p of preds) this.anomalies.set(p.assetId, (this.anomalies.get(p.assetId) ?? 0) + 1);

    for (const s of solar) {
      const id = s.houseId;
      this.meta.set(id, {
        capacityKwp: s.capacityKwp,
        baselinePr: s.baselinePr,
        ageYears: (now - s.installDate) / DAY / 365,
        maintenance: s.registryStatus === "maintenance",
      });
      const row = sNow.get(id);
      const expectedW = expectedPowerW(s.capacityKwp, g, amb, s.baselinePr);
      this.pv.set(id, {
        id, gangId: s.house.gangId, acW: row?.acPowerW ?? 0, dcV: row?.dcVoltage ?? 0, dcI: row?.dcCurrent ?? 0,
        tempC: row?.panelTempC ?? amb, inverter: row?.inverter ?? "IDLE", rssi: -70, expectedW,
        ratio: expectedW > 0 ? (row?.acPowerW ?? 0) / expectedW : 1, todayKwh: eToday.get(id) ?? 0,
        capacityKwp: s.capacityKwp, status: "normal", health: 0,
      });
    }
    for (const b of batts) {
      const r = bNow.get(b.id);
      this.batteries.set(b.id, {
        id: b.id, gangId: b.gangId, voltage: r?.voltage ?? 51, currentA: r?.currentA ?? 0, soc: r?.soc ?? 50,
        soh: r?.soh ?? 90, tempC: r?.tempC ?? 30, spreadMv: r?.spreadMv ?? 30, cycles: r?.cycles ?? 0,
        bms: r?.bms ?? "OK", rssi: -68, status: "normal", health: 0,
      });
    }
    for (const gw of gws) {
      const m = mNow.get(gw.gangId);
      const pvToday = gangToday.find((x) => x.scopeId === gw.gangId)?._sum.pvW ?? 0;
      this.gangs.set(gw.gangId, {
        id: gw.gangId, pvW: m?.pvW ?? 0, loadW: m?.loadW ?? 0, plnW: m?.plnImportW ?? 0, chargeW: m?.chargeW ?? 0,
        dischargeW: m?.dischargeW ?? 0, curtailW: m?.curtailW ?? 0, avgSoc: 0, irradiance: g, ambientC: amb,
        status: "normal", critical: 0, warning: 0, todayKwh: (pvToday * 300) / 3600 / 1000,
      });
      this.gateways.set(gw.id, { id: gw.id, gangId: gw.gangId, online: true, lastSeen: 0, bufferEstimate: 0, lastSyncCount: 0 });
    }
    this.recompute();
    if (!holder.__watchdog) holder.__watchdog = setInterval(() => void this.enqueue(() => this.watchdog()), 2000);
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const next = this.queue.then(job, job);
    this.queue = next.catch((e) => console.error("[live]", e));
    return next;
  }

  ingest(gatewayId: string, raw: unknown[]) {
    return this.enqueue(async () => {
      await this.init();
      return this.process(gatewayId, raw);
    });
  }

  private async process(gatewayId: string, raw: unknown[]) {
    const nowReal = realNow();
    this.lastAnyMessage = nowReal;
    let accepted = 0;
    let rejected = 0;
    let duplicates = 0;
    let bufferedCount = 0;
    const toPersist: TelemetryMessage[] = [];

    for (const item of raw) {
      const parsed = telemetryMessage.safeParse(item);
      if (!parsed.success || parsed.data.gatewayId !== gatewayId) {
        rejected += 1;
        this.quarantine.push({ at: nowReal, reason: parsed.success ? "gateway mismatch" : parsed.error.issues[0]?.message ?? "invalid" });
        if (this.quarantine.length > 50) this.quarantine.shift();
        continue;
      }
      const msg = parsed.data;
      const last = this.lastSeq.get(msg.deviceId);
      if (last !== undefined && msg.seq <= last) {
        duplicates += 1;
        continue;
      }
      this.lastSeq.set(msg.deviceId, msg.seq);
      accepted += 1;
      if (msg.buffered) bufferedCount += 1;
      this.apply(msg, nowReal);
      if (this.clock.mode === "real") {
        const ts = parseTs(msg.ts);
        const b = Math.floor(ts / 300) * 300;
        if (this.lastBucket.get(msg.deviceId) !== b) {
          this.lastBucket.set(msg.deviceId, b);
          toPersist.push(msg);
        }
      }
    }
    this.quality.accepted += accepted;
    this.quality.rejected += rejected;
    this.quality.duplicates += duplicates;
    this.quality.buffered += bufferedCount;

    const gw = this.gateways.get(gatewayId);
    if (gw) {
      const wasOffline = !gw.online;
      gw.online = true;
      gw.lastSeen = nowReal;
      gw.bufferEstimate = 0;
      this.offlineSince.delete(gatewayId);
      if (bufferedCount > 0) {
        gw.lastSyncCount = bufferedCount;
        this.emitAlert({ kind: "sync", assetId: gatewayId, gangId: gw.gangId, count: bufferedCount, message: `${gatewayId} tersambung kembali. ${bufferedCount} pesan dari buffer tersinkron.` }, gw.gangId);
      }
      if (wasOffline) await this.resolve(`${gatewayId}:gateway_offline`);
      await this.evaluateGang(gw.gangId);
    }
    if (toPersist.length) await this.persist(toPersist);
    this.recompute();
    this.scheduleFlush();
    return { accepted, rejected, duplicates, directive: this.directive };
  }

  private apply(msg: TelemetryMessage, nowReal: number) {
    this.lastSeen.set(msg.assetId, nowReal);
    if (msg.type === "pv") {
      const p = this.pv.get(msg.assetId);
      if (!p) return;
      const m = msg.metrics;
      const gang = this.gangs.get(p.gangId);
      const meta = this.meta.get(p.id);
      const prevW = p.acW;
      p.acW = m.acPowerW; p.dcV = m.dcVoltage; p.dcI = m.dcCurrent; p.tempC = m.panelTempC;
      p.inverter = msg.status.inverter; p.rssi = msg.status.rssi;
      if (gang && meta) {
        p.expectedW = expectedPowerW(meta.capacityKwp, gang.irradiance, gang.ambientC, meta.baselinePr);
        p.ratio = p.expectedW > 1 ? m.acPowerW / p.expectedW : 1;
      }
      if (this.clock.mode === "real") p.todayKwh += ((prevW + m.acPowerW) / 2) * (2 / 3600) / 1000;
      this.pushRing(p.id, nowReal, m.acPowerW, p.expectedW);
    } else if (msg.type === "battery") {
      const b = this.batteries.get(msg.assetId);
      if (!b) return;
      const m = msg.metrics;
      b.voltage = m.voltage; b.currentA = m.currentA; b.soc = m.soc; b.soh = m.soh; b.tempC = m.tempC;
      b.spreadMv = m.spreadMv; b.cycles = m.cycles; b.bms = msg.status.bms; b.rssi = msg.status.rssi;
      this.pushRing(b.id, nowReal, m.tempC, m.soc);
    } else {
      const g = this.gangs.get(msg.assetId);
      if (!g) return;
      const m = msg.metrics;
      g.pvW = m.pvW; g.loadW = m.loadW; g.plnW = m.plnImportW; g.chargeW = m.chargeW; g.dischargeW = m.dischargeW;
      g.curtailW = m.curtailW; g.irradiance = m.irradiance; g.ambientC = m.ambientC;
    }
  }

  private pushRing(id: string, t: number, a: number, b: number) {
    const ring = this.rings.get(id) ?? [];
    ring.push({ t, a, b });
    if (ring.length > RING) ring.shift();
    this.rings.set(id, ring);
  }

  private async evaluateGang(gangId: string) {
    const gang = this.gangs.get(gangId);
    if (!gang) return;
    for (const p of this.pv.values()) {
      if (p.gangId !== gangId || this.isDeviceOffline(p.id)) continue;
      const conds = evaluatePv({ id: p.id, acW: p.acW, dcV: p.dcV, dcI: p.dcI, inverter: p.inverter, ratio: p.ratio }, gang.irradiance);
      if (conds === null) continue;
      await this.sync(p.id, "pv", gangId, conds, PV_TYPES);
    }
    for (const b of this.batteries.values()) {
      if (b.gangId !== gangId) continue;
      await this.sync(b.id, "battery", gangId, evaluateBattery(b), BATT_TYPES);
    }
  }

  /** Raises after 2 consecutive evaluations, and clears after 3 so that noise cannot flap an alert. */
  private async sync(assetId: string, assetType: string, gangId: string, conds: Condition[], types: AlertType[]) {
    const active = new Set(conds.map((c) => c.type));
    for (const c of conds) {
      const key = `${assetId}:${c.type}`;
      this.clears.delete(key);
      const existing = this.open.get(key);
      if (existing) {
        if (existing.priority !== c.priority && rank(c.priority) > rank(existing.priority)) {
          await this.upgrade(existing, c);
        }
        continue;
      }
      const n = (this.hits.get(key) ?? 0) + 1;
      this.hits.set(key, n);
      if (n >= 2) {
        this.hits.delete(key);
        await this.raise(assetId, assetType, gangId, c);
      }
    }
    for (const t of types) {
      if (active.has(t)) continue;
      const key = `${assetId}:${t}`;
      this.hits.delete(key);
      if (!this.open.has(key)) continue;
      const n = (this.clears.get(key) ?? 0) + 1;
      this.clears.set(key, n);
      if (n >= 3) {
        this.clears.delete(key);
        await this.resolve(key);
      }
    }
  }

  private nextId(): string {
    this.alertSeq += 1;
    return `LIVE-${realNow()}-${this.alertSeq}`;
  }

  private async raise(assetId: string, assetType: string, gangId: string, c: Condition) {
    const id = this.nextId();
    const at = simNow(this.clock);
    await prisma.alert.create({
      data: { id, assetType, assetId, gangId, type: c.type, priority: c.priority, message: c.message, recommendedAction: c.recommendedAction, status: "open", createdAt: at },
    });
    const entry: OpenAlert = { id, assetId, assetType, gangId, type: c.type, priority: c.priority };
    this.open.set(`${assetId}:${c.type}`, entry);
    await this.createAnomaly(entry, at);
    this.emitAlert({ kind: "new", id, assetId, gangId, priority: c.priority, message: c.message, recommendedAction: c.recommendedAction }, gangId);
  }

  private async upgrade(existing: OpenAlert, c: Condition) {
    existing.priority = c.priority;
    await prisma.alert.update({
      where: { id: existing.id },
      data: { priority: c.priority, message: c.message, recommendedAction: c.recommendedAction },
    });
    const pred = await prisma.aiPrediction.findFirst({ where: { alertId: existing.id } });
    if (pred) {
      const payload = JSON.parse(pred.payloadJson) as AnomalyPayload;
      payload.severity = c.priority;
      const fresh = await this.diagnosisFor(existing);
      if (fresh) payload.diagnosis = fresh;
      await prisma.aiPrediction.update({ where: { id: pred.id }, data: { payloadJson: JSON.stringify(payload), confidence: fresh?.confidence ?? pred.confidence } });
    }
    this.emitAlert({ kind: "upgraded", id: existing.id, assetId: existing.assetId, gangId: existing.gangId, priority: c.priority, message: c.message, recommendedAction: c.recommendedAction }, existing.gangId);
  }

  private async resolve(key: string) {
    const a = this.open.get(key);
    if (!a) return;
    this.open.delete(key);
    const at = simNow(this.clock);
    await prisma.alert.update({ where: { id: a.id }, data: { status: "resolved", resolvedAt: at } });
    const pred = await prisma.aiPrediction.findFirst({ where: { alertId: a.id } });
    if (pred) {
      const payload = JSON.parse(pred.payloadJson) as AnomalyPayload;
      payload.open = false;
      await prisma.aiPrediction.update({ where: { id: pred.id }, data: { payloadJson: JSON.stringify(payload) } });
    }
    this.emitAlert({ kind: "resolved", id: a.id, assetId: a.assetId, gangId: a.gangId }, a.gangId);
  }

  private async diagnosisFor(a: OpenAlert) {
    if (a.assetType === "pv") return this.diagnosePvLive(a.assetId);
    if (a.assetType === "battery") return this.diagnoseBatteryLive(a.assetId);
    return null;
  }

  private async createAnomaly(a: OpenAlert, at: number) {
    const diagnosis = await this.diagnosisFor(a);
    const pattern: Anomaly["pattern"] =
      a.type === "battery_temp" ? "thermal"
      : a.type === "cell_imbalance" ? "imbalance"
      : a.type === "soh_degradation" ? "aging"
      : a.type === "sensor_suspect" ? "sensor"
      : a.type === "inverter_trip" ? "sudden_zero"
      : "partial";
    const live = this.pv.get(a.assetId);
    const payload: AnomalyPayload = {
      metric: a.assetType === "pv" ? "acPowerW" : a.type === "battery_temp" ? "tempC" : "connection",
      methods: a.assetType === "pv" ? ["residual", "peer"] : a.type === "gateway_offline" ? ["threshold"] : ["threshold", "peer"],
      from: at,
      to: at,
      deviationPct: live ? (live.ratio - 1) * 100 : 0,
      severity: a.priority,
      pattern,
      title: a.type === "gateway_offline" ? "Gateway berhenti mengirim data" : anomalyTitle(pattern),
      open: true,
      diagnosis,
    };
    await prisma.aiPrediction.create({
      data: {
        id: `ANM-${a.id}`, assetType: a.assetType, assetId: a.assetId, gangId: a.gangId, kind: "anomaly",
        payloadJson: JSON.stringify(payload), confidence: diagnosis?.confidence ?? 0.5, modelVersion: MODEL_VERSION, alertId: a.id, createdAt: at,
      },
    });
    this.anomalies.set(a.assetId, (this.anomalies.get(a.assetId) ?? 0) + 1);
  }

  private peerRatio(gangId: string, exclude: string): number {
    const list = [...this.pv.values()].filter((p) => p.gangId === gangId && p.id !== exclude && !this.isDeviceOffline(p.id)).map((p) => p.ratio);
    return list.length ? median(list) : 1;
  }

  private async diagnosePvLive(id: string) {
    const p = this.pv.get(id);
    const meta = this.meta.get(id);
    const gang = p ? this.gangs.get(p.gangId) : undefined;
    if (!p || !meta || !gang) return null;
    const now = simNow(this.clock);
    const from = now - 30 * DAY;
    const [rows, wx, peers] = await Promise.all([
      prisma.solarTelemetry.findMany({ where: { assetId: id, res: 60, ts: { gte: from, lte: now } }, orderBy: { ts: "asc" } }),
      prisma.weatherReading.findMany({ where: { res: 60, ts: { gte: from, lte: now } } }),
      this.peerDaily(p.gangId, id, from, now),
    ]);
    const weather = new Map<number, HourlyWeather>(wx.map((w) => [w.ts, { ts: w.ts, irradiance: w.irradiance, ambientC: w.ambientC }]));
    const hourly: PvHourlyRow[] = rows.map((r) => ({ ts: r.ts, acW: r.acPowerW, dcV: r.dcVoltage, dcI: r.dcCurrent, inverter: r.inverter }));
    const f = pvFeatures(
      { capacityKwp: meta.capacityKwp, baselinePr: meta.baselinePr, rows: hourly, weather, peersByDay: await peers(weather) },
      now,
      { acW: p.acW, dcV: p.dcV, dcI: p.dcI, inverter: p.inverter, irradiance: gang.irradiance, ambientC: gang.ambientC, peerRatio: this.peerRatio(p.gangId, id) },
    );
    return runPvDiagnosis(f);
  }

  private async peerDaily(gangId: string, exclude: string, from: number, to: number) {
    const peers = [...this.pv.values()].filter((p) => p.gangId === gangId && p.id !== exclude).map((p) => p.id);
    const rows = await prisma.solarTelemetry.findMany({ where: { assetId: { in: peers }, res: 60, ts: { gte: from, lte: to } }, select: { assetId: true, ts: true, acPowerW: true } });
    return async (weather: Map<number, HourlyWeather>) => {
      const byDay = new Map<number, number[]>();
      for (const peer of peers) {
        const meta = this.meta.get(peer);
        if (!meta) continue;
        const series = rows.filter((r) => r.assetId === peer).map((r) => ({ ts: r.ts, acW: r.acPowerW }));
        for (const d of dailyRatios(series, weather, meta.capacityKwp, meta.baselinePr)) {
          const list = byDay.get(d.day) ?? [];
          list.push(d.ratio);
          byDay.set(d.day, list);
        }
      }
      return byDay;
    };
  }

  private diagnoseBatteryLive(id: string) {
    const b = this.batteries.get(id);
    if (!b) return null;
    const gang = this.gangs.get(b.gangId);
    const peers = [...this.batteries.values()].filter((o) => o.gangId === b.gangId && o.id !== id).map((o) => o.tempC);
    const ring = (this.rings.get(id) ?? []).slice(-10);
    let rise = 0;
    if (ring.length >= 2) {
      const dtMin = Math.max((ring[ring.length - 1].t - ring[0].t) / 60, 1 / 30);
      rise = (ring[ring.length - 1].a - ring[0].a) / dtMin;
    }
    return runBatteryDiagnosis({
      tempC: b.tempC, ambientC: gang?.ambientC ?? 30, peerTempC: median(peers), tempRisePerMin: rise,
      currentA: b.currentA, spreadMv: b.spreadMv, soh: b.soh, bmsAlarm: b.bms === "ALARM", implausibleSteps: false,
    });
  }

  private isDeviceOffline(id: string): boolean {
    return this.open.has(`${id}:device_offline`);
  }

  private async watchdog() {
    if (!this.ready) return;
    await this.ready;
    const nowReal = realNow();
    const seenAny = this.lastAnyMessage > 0 && nowReal - this.lastAnyMessage <= OFFLINE_AFTER;
    let changed = false;
    for (const gw of this.gateways.values()) {
      if (gw.lastSeen === 0) continue;
      const silent = nowReal - gw.lastSeen > OFFLINE_AFTER;
      if (silent && gw.online && seenAny) {
        gw.online = false;
        this.offlineSince.set(gw.id, nowReal);
        changed = true;
        await this.raise(gw.id, "gateway", gw.gangId, {
          type: "gateway_offline",
          priority: "high",
          message: `${gw.id} terputus. Data ${gw.gangId.replace("G", "Gang ")} ditampung di buffer lokal.`,
          recommendedAction: "Periksa koneksi internet gateway. Data akan tersinkron otomatis saat tersambung.",
        });
      }
      if (!gw.online) {
        const since = this.offlineSince.get(gw.id) ?? nowReal;
        gw.bufferEstimate = Math.round(((nowReal - since) / 2) * 31);
        changed = true;
      }
    }
    if (changed) {
      this.recompute();
      this.scheduleFlush();
    }
  }

  private async persist(messages: TelemetryMessage[]) {
    const ops = [];
    for (const m of messages) {
      const ts = Math.floor(parseTs(m.ts) / 300) * 300;
      if (m.type === "pv") {
        const data = { dcVoltage: m.metrics.dcVoltage, dcCurrent: m.metrics.dcCurrent, acPowerW: m.metrics.acPowerW, energyWh: (m.metrics.acPowerW * 300) / 3600, panelTempC: m.metrics.panelTempC, inverter: m.status.inverter };
        ops.push(prisma.solarTelemetry.upsert({ where: { assetId_res_ts: { assetId: m.assetId, res: 5, ts } }, create: { assetId: m.assetId, res: 5, ts, ...data }, update: data }));
      } else if (m.type === "battery") {
        const data = { voltage: m.metrics.voltage, currentA: m.metrics.currentA, soc: m.metrics.soc, soh: m.metrics.soh, tempC: m.metrics.tempC, spreadMv: m.metrics.spreadMv, cycles: m.metrics.cycles, bms: m.status.bms };
        ops.push(prisma.batteryTelemetry.upsert({ where: { assetId_res_ts: { assetId: m.assetId, res: 5, ts } }, create: { assetId: m.assetId, res: 5, ts, ...data }, update: data }));
      } else {
        const data = { pvW: m.metrics.pvW, loadW: m.metrics.loadW, plnImportW: m.metrics.plnImportW, chargeW: m.metrics.chargeW, dischargeW: m.metrics.dischargeW, curtailW: m.metrics.curtailW };
        ops.push(prisma.energyMeterReading.upsert({ where: { scopeId_res_ts: { scopeId: m.assetId, res: 5, ts } }, create: { scopeId: m.assetId, res: 5, ts, ...data }, update: data }));
      }
    }
    await prisma.$transaction(ops);
  }

  /** Derives statuses and health scores. Status always comes from open alerts plus connectivity. */
  private recompute() {
    const gwOffline = new Set([...this.gateways.values()].filter((g) => !g.online).map((g) => g.gangId));
    const worst = new Map<string, AlertPriority>();
    for (const a of this.open.values()) {
      const cur = worst.get(a.assetId);
      if (!cur || rank(a.priority) > rank(cur)) worst.set(a.assetId, a.priority);
    }
    const toStatus = (id: string, gangId: string, maintenance = false): AssetStatus => {
      if (maintenance) return "maintenance";
      if (gwOffline.has(gangId) || this.isDeviceOffline(id)) return "offline";
      const p = worst.get(id);
      if (p === "critical") return "critical";
      if (p === "high" || p === "medium") return "warning";
      return "normal";
    };
    for (const p of this.pv.values()) {
      const meta = this.meta.get(p.id);
      p.status = toStatus(p.id, p.gangId, meta?.maintenance);
      const gang = this.gangs.get(p.gangId);
      const judged = (gang?.irradiance ?? 0) >= 150;
      const h = pvHealth({
        performanceRatio: judged ? p.ratio : 0.95,
        anomalies30d: this.anomalies.get(p.id) ?? 0,
        dataQuality: p.status === "offline" ? 0.2 : 1,
        openFaultWeight: worst.get(p.id) ? FAULT_WEIGHT[worst.get(p.id) as AlertPriority] : 0,
        ageYears: meta?.ageYears ?? 1,
      });
      this.health.set(p.id, h);
      p.health = h.score;
    }
    for (const b of this.batteries.values()) {
      b.status = toStatus(b.id, b.gangId);
      const h = batteryHealth({
        soh: b.soh, tempC: b.tempC, spreadMv: b.spreadMv, cycles: b.cycles,
        anomalies30d: this.anomalies.get(b.id) ?? 0,
        openFaultWeight: worst.get(b.id) ? FAULT_WEIGHT[worst.get(b.id) as AlertPriority] : 0,
      });
      this.health.set(b.id, h);
      b.health = h.score;
    }
    for (const g of this.gangs.values()) {
      const socs = [...this.batteries.values()].filter((b) => b.gangId === g.id).map((b) => b.soc);
      g.avgSoc = socs.reduce((a, b) => a + b, 0) / Math.max(socs.length, 1);
      const alerts = [...this.open.values()].filter((a) => a.gangId === g.id);
      g.critical = alerts.filter((a) => a.priority === "critical").length;
      g.warning = alerts.filter((a) => a.priority === "high" || a.priority === "medium").length;
      g.status = g.critical > 0 ? "critical" : g.warning > 0 ? "warning" : "normal";
    }
  }

  snapshot(user?: SessionUser): LiveSnapshot {
    const scope = user ? gangScope(user) : null;
    const allow = (g: string) => scope === null || scope.includes(g);
    return {
      simTs: simNow(this.clock),
      clock: this.clock,
      simulatorConnected: this.lastAnyMessage > 0 && realNow() - this.lastAnyMessage <= OFFLINE_AFTER,
      pv: [...this.pv.values()].filter((p) => allow(p.gangId)),
      batteries: [...this.batteries.values()].filter((b) => allow(b.gangId)),
      gangs: [...this.gangs.values()].filter((g) => allow(g.id)),
      gateways: [...this.gateways.values()].filter((g) => allow(g.gangId)),
      openAlerts: [...this.open.values()].filter((a) => allow(a.gangId)).length,
      directive: this.directive,
      quality: this.quality,
    };
  }

  subscribe(user: SessionUser, send: Subscriber["send"]): () => void {
    const sub = { user, send };
    this.subs.add(sub);
    return () => this.subs.delete(sub);
  }

  private scheduleFlush() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      for (const s of this.subs) s.send("snapshot", this.snapshot(s.user));
    }, 250);
  }

  private emitAlert(event: AlertEvent, gangId: string) {
    for (const s of this.subs) {
      const scope = gangScope(s.user);
      if (scope === null || scope.includes(gangId)) s.send("alert", event);
    }
  }

  setClock(clock: ClockConfig) {
    return this.enqueue(async () => {
      this.clock = clock;
      this.directive = { ...this.directive, clock };
      this.ready = null;
      await this.init();
      this.scheduleFlush();
    });
  }

  scenario(name: ScenarioName) {
    return this.enqueue(async () => {
      await this.init();
      if (name === "inverter_h021") this.directive = { ...this.directive, inverterH021: true };
      if (name === "battery_b025_overheat") this.directive = { ...this.directive, batteryB025: true };
      if (name === "gateway_gw3_offline") this.directive = { ...this.directive, gw3Offline: true };
      if (name === "gateway_gw3_reconnect") this.directive = { ...this.directive, gw3Offline: false };
      if (name === "reset") await this.reset();
      this.scheduleFlush();
    });
  }

  private async reset() {
    this.directive = { clock: this.clock, inverterH021: false, batteryB025: false, gw3Offline: false, resetEpoch: this.directive.resetEpoch + 1 };
    await prisma.aiPrediction.deleteMany({ where: { id: { startsWith: "ANM-LIVE-" } } });
    await prisma.alert.deleteMany({ where: { id: { startsWith: "LIVE-" } } });
    await prisma.workOrder.deleteMany({});
    await prisma.alert.updateMany({
      where: { id: { startsWith: "SEED-" } },
      data: { status: "open", acknowledgedBy: null, acknowledgedAt: null, resolvedAt: null, workOrderId: null },
    });
    this.hits.clear();
    this.clears.clear();
    this.rings.clear();
    for (const g of this.gateways.values()) {
      g.online = true;
      g.bufferEstimate = 0;
      g.lastSyncCount = 0;
    }
    this.offlineSince.clear();
    this.ready = null;
    await this.init();
    for (const s of this.subs) s.send("alert", { kind: "reset" } satisfies AlertEvent);
  }
}

function rank(p: AlertPriority): number {
  return { low: 0, medium: 1, high: 2, critical: 3 }[p];
}

const holder = globalThis as unknown as { __liveStore?: LiveStore; __watchdog?: NodeJS.Timeout };
export const live: LiveStore = holder.__liveStore ?? new LiveStore();
holder.__liveStore = live;
export { today };

function today(ts: number): number {
  return dayStart(wibDay(ts));
}
