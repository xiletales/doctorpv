import { prisma } from "../db";
import { batteryHealth, FAULT_WEIGHT, pvHealth, type HealthScore } from "../ai/health";
import { MODEL_VERSION, pvFeatures, runBatteryDiagnosis, runPvDiagnosis, anomalyTitle, type AnomalyPayload, type PvHourlyRow } from "../ai/pipeline";
import type { Anomaly } from "../ai/anomaly";
import type { HourlyWeather } from "../ai/features";
import { dailyRatios } from "../ai/features";
import { expectedPowerW } from "../ai/expected";
import { median } from "../ai/stats";
import { evaluateBattery, evaluateIrradianceSensor, evaluatePv, evaluateWeather, type AlertType, type Condition } from "../alerts/rules";
import { assessPoints, verdictFor, type IrradianceSource, type PointVerdict } from "../ai/assess";
import { diagnoseClusterWeather } from "../ai/rca";
import { clearSky } from "../sim/physics";
import { SITE } from "../site";
import { OpenMeteoProvider } from "../weather/open-meteo";
import { SimulatedWeatherProvider } from "../weather/simulated";
import type { WeatherProvider, WeatherReading } from "../weather/types";
import { CLOUD_FACTOR, telemetryMessage, type ScenarioName, type SimDirective, type TelemetryMessage } from "../contracts/telemetry";
import { dayStart, DAY, defaultClock, simNow, wibDay, type ClockConfig } from "../sim/time";
import type { AlertPriority, AssetStatus } from "../types";
import { areaLabel } from "@/lib/site";

export interface PvLive {
  id: string;
  zoneId: string;
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
  /** The irradiance used for this point's expectation, and where it came from. */
  irradiance: number;
  irradianceSource: IrradianceSource;
  verdict: PointVerdict;
}

export interface BatteryLive {
  id: string;
  zoneId: string;
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

export interface ZoneLive {
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
  zoneId: string;
  online: boolean;
  lastSeen: number;
  bufferEstimate: number;
  lastSyncCount: number;
}

export interface LiveSnapshot {
  simTs: number;
  clock: ClockConfig;
  simulatorConnected: boolean;
  /** True when the seeded data belongs to another day, so that "today" has no history. */
  seedStale: boolean;
  pv: PvLive[];
  batteries: BatteryLive[];
  zones: ZoneLive[];
  gateways: GatewayLive[];
  openAlerts: number;
  /** What the telemetry is being judged against right now. */
  weather: { label: string; irradiance: number; clearFraction: number; cloudCover: number };
  directive: SimDirective;
  quality: { accepted: number; rejected: number; duplicates: number; buffered: number };
}

export interface AlertEvent {
  kind: "new" | "upgraded" | "resolved" | "sync" | "reset" | "refreshed";
  id?: string;
  assetId?: string;
  zoneId?: string;
  priority?: AlertPriority;
  message?: string;
  recommendedAction?: string;
  count?: number;
}

interface OpenAlert {
  id: string;
  assetId: string;
  assetType: string;
  zoneId: string;
  type: AlertType;
  priority: AlertPriority;
}

interface Subscriber {
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
  directive: SimDirective = { clock: this.clock, inverterH21: false, batteryB08: false, gw3Offline: false, cloudy: false, cloudySoiled: false, fastForward: false, repaired: [], resetEpoch: 0 };
  pv = new Map<string, PvLive>();
  batteries = new Map<string, BatteryLive>();
  zones = new Map<string, ZoneLive>();
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
  private seedDay = 0;
  /** Alerts a person closed while the condition still holds. They stay closed until it clears. */
  private suppressed = new Set<string>();
  private offlineSince = new Map<string, number>();
  private sensorValues = new Map<string, number | null>();
  private sensorStuck = new Map<string, number>();
  private sensorProblems = new Map<string, string | null>();
  private peerRatioNow = 1;
  private clearFraction = 1;
  private reference: WeatherReading | null = null;
  private refreshDiagnoses = false;
  /** Simulated telemetry is judged against the simulated sky. WEATHER_REFERENCE=open-meteo is for real sensors. */
  private simulated = new SimulatedWeatherProvider(() => (this.directive.cloudy ? CLOUD_FACTOR : null));
  private openMeteo = new OpenMeteoProvider(
    Number(process.env.NEXT_PUBLIC_MAP_CENTER_LAT ?? SITE.center.lat),
    Number(process.env.NEXT_PUBLIC_MAP_CENTER_LNG ?? SITE.center.lng),
  );
  private get provider(): WeatherProvider {
    return process.env.WEATHER_REFERENCE === "open-meteo" ? this.openMeteo : this.simulated;
  }
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
    const [solar, batts, gws, alerts, preds, solarNow, battNow, meterNow, weatherNow, todayEnergy, zoneToday] = await Promise.all([
      prisma.solarSystem.findMany({ include: { house: true } }),
      prisma.battery.findMany(),
      prisma.gateway.findMany(),
      prisma.alert.findMany({ where: { status: { not: "resolved" } } }),
      prisma.aiPrediction.findMany({ where: { kind: "anomaly" }, select: { assetId: true } }),
      // Latest row per asset, computed in the database so that 2 days of rows do not cross the network.
      prisma.$queryRaw<{ assetId: string; dcVoltage: number; dcCurrent: number; acPowerW: number; panelTempC: number; inverter: string }[]>`
        SELECT DISTINCT ON ("assetId") "assetId", "dcVoltage", "dcCurrent", "acPowerW", "panelTempC", inverter
        FROM "SolarTelemetry" WHERE res = 5 AND ts <= ${bucket} AND ts >= ${bucket - 2 * DAY}
        ORDER BY "assetId", ts DESC`,
      prisma.batteryTelemetry.findMany({ where: { res: 5, ts: bucket } }),
      prisma.energyMeterReading.findMany({ where: { res: 5, ts: bucket } }),
      prisma.weatherReading.findFirst({ where: { res: 5, ts: bucket } }),
      prisma.solarTelemetry.groupBy({ by: ["assetId"], where: { res: 5, ts: { gte: today, lte: now } }, _sum: { energyWh: true } }),
      prisma.energyMeterReading.groupBy({ by: ["scopeId"], where: { res: 5, ts: { gte: today, lte: now } }, _sum: { pvW: true } }),
    ]);
    const seedSetting = await prisma.setting.findUnique({ where: { key: "seedDay" } });
    this.seedDay = Number(seedSetting?.valueJson ?? 0);
    const sNow = new Map(solarNow.map((r) => [r.assetId, r]));
    const bNow = new Map(battNow.map((r) => [r.assetId, r]));
    const mNow = new Map(meterNow.map((r) => [r.scopeId, r]));
    const eToday = new Map(todayEnergy.map((r) => [r.assetId, (r._sum.energyWh ?? 0) / 1000]));
    const g = weatherNow?.irradiance ?? 0;
    const amb = weatherNow?.ambientC ?? 28;

    this.open.clear();
    for (const a of alerts) {
      this.open.set(`${a.assetId}:${a.type}`, {
        id: a.id, assetId: a.assetId, assetType: a.assetType, zoneId: a.zoneId,
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
        id, zoneId: s.house.zoneId, acW: row?.acPowerW ?? 0, dcV: row?.dcVoltage ?? 0, dcI: row?.dcCurrent ?? 0,
        tempC: row?.panelTempC ?? amb, inverter: row?.inverter ?? "IDLE", rssi: -70, expectedW,
        ratio: expectedW > 0 ? (row?.acPowerW ?? 0) / expectedW : 1, todayKwh: eToday.get(id) ?? 0,
        capacityKwp: s.capacityKwp, status: "normal", health: 0, irradiance: g, irradianceSource: "sensor", verdict: "normal",
      });
    }
    for (const b of batts) {
      const r = bNow.get(b.id);
      this.batteries.set(b.id, {
        id: b.id, zoneId: b.zoneId, voltage: r?.voltage ?? 51, currentA: r?.currentA ?? 0, soc: r?.soc ?? 50,
        soh: r?.soh ?? 90, tempC: r?.tempC ?? 30, spreadMv: r?.spreadMv ?? 30, cycles: r?.cycles ?? 0,
        bms: r?.bms ?? "OK", rssi: -68, status: "normal", health: 0,
      });
    }
    for (const gw of gws) {
      const m = mNow.get(gw.zoneId);
      const pvToday = zoneToday.find((x) => x.scopeId === gw.zoneId)?._sum.pvW ?? 0;
      this.zones.set(gw.zoneId, {
        id: gw.zoneId, pvW: m?.pvW ?? 0, loadW: m?.loadW ?? 0, plnW: m?.plnImportW ?? 0, chargeW: m?.chargeW ?? 0,
        dischargeW: m?.dischargeW ?? 0, curtailW: m?.curtailW ?? 0, avgSoc: 0, irradiance: g, ambientC: amb,
        status: "normal", critical: 0, warning: 0, todayKwh: (pvToday * 300) / 3600 / 1000,
      });
      this.gateways.set(gw.id, { id: gw.id, zoneId: gw.zoneId, online: true, lastSeen: 0, bufferEstimate: 0, lastSyncCount: 0 });
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
        this.emitAlert({ kind: "sync", assetId: gatewayId, zoneId: gw.zoneId, count: bufferedCount, message: `${gatewayId} tersambung kembali. ${bufferedCount} pesan dari buffer tersinkron.` });
      }
      if (wasOffline) await this.resolve(`${gatewayId}:gateway_offline`);
      await this.refreshReference();
      this.assess();
      await this.evaluateZone(gw.zoneId);
      await this.evaluateCluster();
      if (this.refreshDiagnoses && gatewayId === "GW-3") await this.refreshOpenDiagnoses();
    }
    // Not awaited, so that a slow network write cannot delay ticks and make gateways look offline.
    if (toPersist.length) void this.persist(toPersist).catch((e) => console.error("[live] persist", e));
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
      const prevW = p.acW;
      p.acW = m.acPowerW; p.dcV = m.dcVoltage; p.dcI = m.dcCurrent; p.tempC = m.panelTempC;
      p.inverter = msg.status.inverter; p.rssi = msg.status.rssi;
      const previous = this.sensorValues.get(p.id);
      this.sensorStuck.set(p.id, previous !== undefined && previous === m.irradiance ? (this.sensorStuck.get(p.id) ?? 0) + 1 : 0);
      this.sensorValues.set(p.id, m.irradiance);
      // A device only comes back once it was repaired, so a late tick around a reset cannot clear the alert.
      if (this.directive.repaired.includes(p.id) && this.open.has(`${p.id}:device_offline`)) void this.resolve(`${p.id}:device_offline`);
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
      const g = this.zones.get(msg.assetId);
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

  private async refreshReference() {
    const now = simNow(this.clock);
    const provided = await this.provider.current(now);
    // A failed outside provider falls back quietly to the simulated reference.
    this.reference = provided ?? (await this.simulated.current(now));
  }

  /** Recomputes every point's expectation from the shared, tested logic in ai/assess. */
  private assess() {
    const reference = this.reference?.irradiance ?? 0;
    const inputs = [...this.pv.values()].filter((p) => !this.isDeviceOffline(p.id) && this.sensorValues.has(p.id)).map((p) => {
      const meta = this.meta.get(p.id);
      return {
        id: p.id, acW: p.acW, panelTempC: p.tempC, capacityKwp: p.capacityKwp, baselinePr: meta?.baselinePr ?? 0.78,
        sensorIrradiance: this.sensorValues.get(p.id) ?? null, sensorStuckTicks: this.sensorStuck.get(p.id) ?? 0,
      };
    });
    const { points, peerRatio } = assessPoints(inputs, reference);
    this.peerRatioNow = peerRatio;
    const clear = clearSky(simNow(this.clock));
    this.clearFraction = clear > 20 ? Math.min(1, reference / clear) : 1;
    for (const a of points) {
      const p = this.pv.get(a.id);
      if (!p) continue;
      p.expectedW = a.expectedW; p.ratio = a.ratio; p.irradiance = a.irradiance; p.irradianceSource = a.source;
      this.sensorProblems.set(a.id, a.sensorProblem);
      const hasFault = this.open.has(`${a.id}:inverter_trip`) || this.open.has(`${a.id}:production_drop`);
      p.verdict = verdictFor(a, this.clearFraction, hasFault, this.open.has(`${a.id}:sensor_suspect`));
    }
    for (const r of [...this.pv.keys()]) {
      if (this.isDeviceOffline(r)) (this.pv.get(r) as PvLive).verdict = "sensor";
    }
  }

  private async evaluateZone(zoneId: string) {
    for (const p of this.pv.values()) {
      if (p.zoneId !== zoneId || this.isDeviceOffline(p.id)) continue;
      const problem = this.sensorProblems.get(p.id) ?? null;
      const conds = evaluatePv({ id: p.id, acW: p.acW, dcV: p.dcV, dcI: p.dcI, inverter: p.inverter, ratio: p.ratio }, p.irradiance, this.peerRatioNow);
      if (conds === null) continue;
      const sensor = evaluateIrradianceSensor(p.id, problem);
      const list = sensor && !conds.some((c) => c.type === "sensor_suspect") ? [...conds, sensor] : conds;
      await this.sync(p.id, "pv", zoneId, list, PV_TYPES);
    }
    for (const b of this.batteries.values()) {
      if (b.zoneId !== zoneId) continue;
      await this.sync(b.id, "battery", zoneId, evaluateBattery(b), BATT_TYPES);
    }
  }

  private clearSkyOutputW(p: PvLive): number {
    const meta = this.meta.get(p.id);
    const clear = clearSky(simNow(this.clock));
    return expectedPowerW(p.capacityKwp, clear, this.reference?.ambientC ?? 28, meta?.baselinePr ?? 0.78);
  }

  /** One low-priority notice for the whole cluster, rather than 30 per-point alerts. */
  private async evaluateCluster() {
    const list = [...this.pv.values()].filter((p) => !this.isDeviceOffline(p.id) && this.sensorValues.has(p.id));
    if (list.length === 0) return;
    const clearSkyW = list.reduce((a, p) => a + this.clearSkyOutputW(p), 0);
    const lowCount = list.filter((p) => p.acW < 0.7 * this.clearSkyOutputW(p)).length;
    const cond = evaluateWeather({ clearFraction: this.clearFraction, clearSkyW, medianRatio: this.peerRatioNow, lowShare: lowCount / list.length });
    await this.sync("KLASTER", "cluster", "CLUSTER", cond ? [cond] : [], ["weather_info"]);
  }

  private async refreshOpenDiagnoses() {
    this.refreshDiagnoses = false;
    for (const a of this.open.values()) {
      if (!PV_TYPES.includes(a.type)) continue;
      const fresh = await this.diagnosePvLive(a.assetId);
      const pred = await prisma.aiPrediction.findFirst({ where: { alertId: a.id } });
      if (!fresh || !pred) continue;
      const payload = JSON.parse(pred.payloadJson) as AnomalyPayload;
      payload.diagnosis = fresh;
      await prisma.aiPrediction.update({ where: { id: pred.id }, data: { payloadJson: JSON.stringify(payload), confidence: fresh.confidence } });
    }
    this.emitAlert({ kind: "refreshed" });
  }

  async weatherStatus(now: number) {
    const used = await this.provider.current(now);
    const real = await this.openMeteo.current(Math.floor(Date.now() / 1000));
    return {
      used: { label: this.provider.label, reading: used },
      real: { label: this.openMeteo.label, reading: real },
    };
  }

  /** Raises after 2 consecutive evaluations, and clears after 3 so that noise cannot flap an alert. */
  private async sync(assetId: string, assetType: string, zoneId: string, conds: Condition[], types: AlertType[]) {
    const active = new Set(conds.map((c) => c.type));
    for (const c of conds) {
      const key = `${assetId}:${c.type}`;
      this.clears.delete(key);
      if (this.suppressed.has(key)) continue;
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
        await this.raise(assetId, assetType, zoneId, c);
      }
    }
    for (const t of types) {
      if (active.has(t)) continue;
      const key = `${assetId}:${t}`;
      this.hits.delete(key);
      this.suppressed.delete(key);
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

  private async raise(assetId: string, assetType: string, zoneId: string, c: Condition) {
    const id = this.nextId();
    const at = simNow(this.clock);
    await prisma.alert.create({
      data: { id, assetType, assetId, zoneId, type: c.type, priority: c.priority, message: c.message, recommendedAction: c.recommendedAction, status: "open", createdAt: at },
    });
    const entry: OpenAlert = { id, assetId, assetType, zoneId, type: c.type, priority: c.priority };
    this.open.set(`${assetId}:${c.type}`, entry);
    await this.createAnomaly(entry, at);
    this.emitAlert({ kind: "new", id, assetId, zoneId, priority: c.priority, message: c.message, recommendedAction: c.recommendedAction });
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
    this.emitAlert({ kind: "upgraded", id: existing.id, assetId: existing.assetId, zoneId: existing.zoneId, priority: c.priority, message: c.message, recommendedAction: c.recommendedAction });
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
    this.emitAlert({ kind: "resolved", id: a.id, assetId: a.assetId, zoneId: a.zoneId });
  }

  private async diagnosisFor(a: OpenAlert) {
    if (a.assetType === "pv") return this.diagnosePvLive(a.assetId);
    if (a.assetType === "battery") return this.diagnoseBatteryLive(a.assetId);
    if (a.assetType === "cluster") {
      const list = [...this.pv.values()].filter((p) => !this.isDeviceOffline(p.id));
      return diagnoseClusterWeather({
        clearFraction: this.clearFraction,
        medianRatio: this.peerRatioNow,
        lowCount: list.filter((p) => p.acW < 0.7 * this.clearSkyOutputW(p)).length,
        total: list.length,
        sensorIrradiance: median(list.map((p) => p.irradiance)),
        referenceIrradiance: this.reference?.irradiance ?? 0,
        referenceLabel: this.provider.label,
      });
    }
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
      : a.type === "weather_info" ? "weather"
      : "partial";
    const live = this.pv.get(a.assetId);
    const payload: AnomalyPayload = {
      metric: a.assetType === "pv" ? "acPowerW" : a.type === "battery_temp" ? "tempC" : a.assetType === "cluster" ? "irradiance" : "connection",
      methods: a.assetType === "pv" || a.assetType === "cluster" ? ["residual", "peer"] : a.type === "gateway_offline" ? ["threshold"] : ["threshold", "peer"],
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
        id: `ANM-${a.id}`, assetType: a.assetType, assetId: a.assetId, zoneId: a.zoneId, kind: "anomaly",
        payloadJson: JSON.stringify(payload), confidence: diagnosis?.confidence ?? 0.5, modelVersion: MODEL_VERSION, alertId: a.id, createdAt: at,
      },
    });
    this.anomalies.set(a.assetId, (this.anomalies.get(a.assetId) ?? 0) + 1);
  }

  private peerRatio(exclude: string): number {
    const list = [...this.pv.values()].filter((p) => p.id !== exclude && !this.isDeviceOffline(p.id)).map((p) => p.ratio);
    return list.length ? median(list) : 1;
  }

  private async diagnosePvLive(id: string) {
    const p = this.pv.get(id);
    const meta = this.meta.get(id);
    const zone = p ? this.zones.get(p.zoneId) : undefined;
    if (!p || !meta || !zone) return null;
    const now = simNow(this.clock);
    const from = now - 30 * DAY;
    const [rows, wx, peers] = await Promise.all([
      prisma.solarTelemetry.findMany({ where: { assetId: id, res: 60, ts: { gte: from, lte: now } }, orderBy: { ts: "asc" } }),
      prisma.weatherReading.findMany({ where: { res: 60, ts: { gte: from, lte: now } } }),
      this.peerDaily(id, from, now),
    ]);
    const weather = new Map<number, HourlyWeather>(wx.map((w) => [w.ts, { ts: w.ts, irradiance: w.irradiance, ambientC: w.ambientC }]));
    const hourly: PvHourlyRow[] = rows.map((r) => ({ ts: r.ts, acW: r.acPowerW, dcV: r.dcVoltage, dcI: r.dcCurrent, inverter: r.inverter }));
    const f = pvFeatures(
      { capacityKwp: meta.capacityKwp, baselinePr: meta.baselinePr, rows: hourly, weather, peersByDay: await peers(weather) },
      now,
      { acW: p.acW, dcV: p.dcV, dcI: p.dcI, inverter: p.inverter, irradiance: zone.irradiance, ambientC: zone.ambientC, peerRatio: this.peerRatio(id), clearFraction: this.clearFraction, sensorProblem: this.sensorProblems.get(id) ?? null },
    );
    return runPvDiagnosis(f);
  }

  private async peerDaily(exclude: string, from: number, to: number) {
    const peers = [...this.pv.values()].filter((p) => p.id !== exclude).map((p) => p.id);
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
    const zone = this.zones.get(b.zoneId);
    const peers = [...this.batteries.values()].filter((o) => o.id !== id).map((o) => o.tempC);
    const ring = (this.rings.get(id) ?? []).slice(-10);
    let rise = 0;
    if (ring.length >= 2) {
      const dtMin = Math.max((ring[ring.length - 1].t - ring[0].t) / 60, 1 / 30);
      rise = (ring[ring.length - 1].a - ring[0].a) / dtMin;
    }
    return runBatteryDiagnosis({
      tempC: b.tempC, ambientC: zone?.ambientC ?? 30, peerTempC: median(peers), tempRisePerMin: rise,
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
        await this.raise(gw.id, "gateway", gw.zoneId, {
          type: "gateway_offline",
          priority: "high",
          message: `${gw.id} terputus. Data ${areaLabel(gw.zoneId)} ditampung di buffer lokal.`,
          recommendedAction: "Periksa koneksi internet gateway. Data akan tersinkron otomatis saat tersambung.",
        });
      }
      if (!gw.online) {
        const since = this.offlineSince.get(gw.id) ?? nowReal;
        gw.bufferEstimate = Math.round(((nowReal - since) / 2) * 16);
        changed = true;
      }
    }
    if (changed) {
      this.recompute();
      this.scheduleFlush();
    }
  }

  /**
   * Writes one batch per table in a single transaction. Re-sent or forecast rows at the same
   * time are replaced, which keeps late-arriving buffered data at its correct timestamp.
   */
  private async persist(messages: TelemetryMessage[]) {
    const bucketOf = (m: TelemetryMessage) => Math.floor(parseTs(m.ts) / 300) * 300;
    const solar = messages.flatMap((m) => (m.type !== "pv" ? [] : [{
      assetId: m.assetId, res: 5, ts: bucketOf(m), dcVoltage: m.metrics.dcVoltage, dcCurrent: m.metrics.dcCurrent, acPowerW: m.metrics.acPowerW,
      energyWh: (m.metrics.acPowerW * 300) / 3600, panelTempC: m.metrics.panelTempC, inverter: m.status.inverter,
    }]));
    const battery = messages.flatMap((m) => (m.type !== "battery" ? [] : [{
      assetId: m.assetId, res: 5, ts: bucketOf(m), voltage: m.metrics.voltage, currentA: m.metrics.currentA, soc: m.metrics.soc, soh: m.metrics.soh,
      tempC: m.metrics.tempC, spreadMv: m.metrics.spreadMv, cycles: m.metrics.cycles, bms: m.status.bms,
    }]));
    const meter = messages.flatMap((m) => (m.type !== "meter" ? [] : [{
      scopeId: m.assetId, res: 5, ts: bucketOf(m), pvW: m.metrics.pvW, loadW: m.metrics.loadW, plnImportW: m.metrics.plnImportW,
      chargeW: m.metrics.chargeW, dischargeW: m.metrics.dischargeW, curtailW: m.metrics.curtailW,
    }]));
    await prisma.$transaction([
      prisma.solarTelemetry.deleteMany({ where: { res: 5, OR: solar.map((r) => ({ assetId: r.assetId, ts: r.ts })) } }),
      prisma.solarTelemetry.createMany({ data: solar, skipDuplicates: true }),
      prisma.batteryTelemetry.deleteMany({ where: { res: 5, OR: battery.map((r) => ({ assetId: r.assetId, ts: r.ts })) } }),
      prisma.batteryTelemetry.createMany({ data: battery, skipDuplicates: true }),
      prisma.energyMeterReading.deleteMany({ where: { res: 5, OR: meter.map((r) => ({ scopeId: r.scopeId, ts: r.ts })) } }),
      prisma.energyMeterReading.createMany({ data: meter, skipDuplicates: true }),
    ]);
  }

  /** Derives statuses and health scores. Status always comes from open alerts plus connectivity. */
  private recompute() {
    const gwOffline = new Set([...this.gateways.values()].filter((g) => !g.online).map((g) => g.zoneId));
    const worst = new Map<string, AlertPriority>();
    for (const a of this.open.values()) {
      const cur = worst.get(a.assetId);
      if (!cur || rank(a.priority) > rank(cur)) worst.set(a.assetId, a.priority);
    }
    const toStatus = (id: string, zoneId: string, maintenance = false): AssetStatus => {
      if (maintenance) return "maintenance";
      if (gwOffline.has(zoneId) || this.isDeviceOffline(id)) return "offline";
      const p = worst.get(id);
      if (p === "critical") return "critical";
      if (p === "high" || p === "medium") return "warning";
      return "normal";
    };
    for (const p of this.pv.values()) {
      const meta = this.meta.get(p.id);
      p.status = toStatus(p.id, p.zoneId, meta?.maintenance);
      const judged = p.irradiance >= 150;
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
      b.status = toStatus(b.id, b.zoneId);
      const h = batteryHealth({
        soh: b.soh, tempC: b.tempC, spreadMv: b.spreadMv, cycles: b.cycles,
        anomalies30d: this.anomalies.get(b.id) ?? 0,
        openFaultWeight: worst.get(b.id) ? FAULT_WEIGHT[worst.get(b.id) as AlertPriority] : 0,
      });
      this.health.set(b.id, h);
      b.health = h.score;
    }
    for (const g of this.zones.values()) {
      const socs = [...this.batteries.values()].filter((b) => b.zoneId === g.id).map((b) => b.soc);
      g.avgSoc = socs.reduce((a, b) => a + b, 0) / Math.max(socs.length, 1);
      const alerts = [...this.open.values()].filter((a) => a.zoneId === g.id);
      g.critical = alerts.filter((a) => a.priority === "critical").length;
      g.warning = alerts.filter((a) => a.priority === "high" || a.priority === "medium").length;
      g.status = g.critical > 0 ? "critical" : g.warning > 0 ? "warning" : "normal";
    }
  }

  snapshot(): LiveSnapshot {
    return {
      simTs: simNow(this.clock),
      clock: this.clock,
      simulatorConnected: this.lastAnyMessage > 0 && realNow() - this.lastAnyMessage <= OFFLINE_AFTER,
      seedStale: this.seedDay !== wibDay(simNow(this.clock)),
      pv: [...this.pv.values()],
      batteries: [...this.batteries.values()],
      zones: [...this.zones.values()],
      gateways: [...this.gateways.values()],
      openAlerts: [...this.open.values()].filter((a) => a.type !== "weather_info").length,
      weather: {
        label: this.provider.label,
        irradiance: this.reference?.irradiance ?? [...this.zones.values()][0]?.irradiance ?? 0,
        clearFraction: this.clearFraction,
        cloudCover: this.reference?.cloudCover ?? 0,
      },
      directive: this.directive,
      quality: this.quality,
    };
  }

  subscribe(send: Subscriber["send"]): () => void {
    const sub = { send };
    this.subs.add(sub);
    return () => this.subs.delete(sub);
  }

  private scheduleFlush() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      for (const s of this.subs) s.send("snapshot", this.snapshot());
    }, 250);
  }

  private emitAlert(event: AlertEvent) {
    for (const s of this.subs) s.send("alert", event);
  }

  /** Applies a person's status change. Closing keeps the alert closed until its condition clears. */
  setAlertStatus(id: string, status: "acknowledged" | "in_progress" | "resolved", userName: string) {
    return this.enqueue(async () => {
      await this.init();
      const at = simNow(this.clock);
      const current = await prisma.alert.findUnique({ where: { id } });
      if (!current) return null;
      const updated = await prisma.alert.update({
        where: { id },
        data: {
          status,
          acknowledgedBy: current.acknowledgedBy ?? userName,
          acknowledgedAt: current.acknowledgedAt ?? at,
          resolvedAt: status === "resolved" ? at : null,
        },
      });
      await prisma.auditLog.create({
        data: { id: `AUD-${Date.now()}-${id}`, userId: userName, action: `alert:${status}`, entity: "Alert", entityId: id, detail: `${current.status} ke ${status}`, createdAt: realNow() },
      });
      if (status === "resolved") {
        const key = `${current.assetId}:${current.type}`;
        this.open.delete(key);
        this.suppressed.add(key);
      }
      this.recompute();
      this.scheduleFlush();
      this.emitAlert({ kind: "resolved", id, assetId: current.assetId, zoneId: current.zoneId });
      return updated;
    });
  }

  /** A completed work order fixes the asset in the simulation, so its readings recover on their own. */
  repair(assetId: string) {
    return this.enqueue(async () => {
      this.directive = {
        ...this.directive,
        inverterH21: assetId === "H21" ? false : this.directive.inverterH21,
        batteryB08: assetId === "B08" ? false : this.directive.batteryB08,
        repaired: [...new Set([...this.directive.repaired, assetId])],
      };
      this.scheduleFlush();
    });
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
      if (name === "inverter_h21") this.directive = { ...this.directive, inverterH21: true, repaired: this.directive.repaired.filter((a) => a !== "H21") };
      if (name === "battery_b08_overheat") this.directive = { ...this.directive, batteryB08: true };
      // Both cloud scenarios clear other faults first, so that the weather-versus-fault story stands alone.
      if (name === "cloudy_day") this.directive = { ...this.directive, cloudy: true, cloudySoiled: false, repaired: [...new Set([...this.directive.repaired, "H07", "H13", "B11", "H26"])] };
      if (name === "cloudy_soiled") this.directive = { ...this.directive, cloudy: true, cloudySoiled: true, repaired: [...new Set([...this.directive.repaired, "H13", "B11", "H26"])].filter((a) => a !== "H07") };
      if (name === "cloudy_day" || name === "cloudy_soiled") this.refreshDiagnoses = true;
      if (name === "fast_forward_30d") this.directive = { ...this.directive, fastForward: !this.directive.fastForward };
      if (name === "gateway_gw3_offline") this.directive = { ...this.directive, gw3Offline: true };
      if (name === "gateway_gw3_reconnect") this.directive = { ...this.directive, gw3Offline: false };
      if (name === "reset") await this.reset();
      this.scheduleFlush();
    });
  }

  private async reset() {
    this.directive = { clock: this.clock, inverterH21: false, batteryB08: false, gw3Offline: false, cloudy: false, cloudySoiled: false, fastForward: false, repaired: [], resetEpoch: this.directive.resetEpoch + 1 };
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
    this.suppressed.clear();
    this.sensorValues.clear();
    this.sensorStuck.clear();
    this.sensorProblems.clear();
    for (const g of this.gateways.values()) {
      g.online = true;
      g.bufferEstimate = 0;
      g.lastSyncCount = 0;
    }
    this.offlineSince.clear();
    this.ready = null;
    await this.init();
    this.refreshDiagnoses = true;
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
