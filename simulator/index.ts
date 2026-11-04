import "dotenv/config";
import { gatewayKey } from "../src/lib/live/gateway-key";
import { CLOUD_FACTOR, type SimDirective, type TelemetryMessage } from "../src/lib/contracts/telemetry";
import { Engine, type WorldSample } from "../src/lib/sim/engine";
import { defaultFaults, type Fault } from "../src/lib/sim/faults";
import { hash01 } from "../src/lib/sim/rng";
import { dayStart, DAY, defaultClock, simNow, wibDay } from "../src/lib/sim/time";
import { buildWorld, envCenter, ZONE_IDS } from "../src/lib/sim/world";

const BASE = process.env.SIM_TARGET ?? "http://localhost:3000";
const TICK_MS = Number(process.env.SIM_TICK_MS ?? 2000);
const SECRET = process.env.GATEWAY_KEY_SECRET ?? "";
const BUFFER_LIMIT = 20000;
const B08_STEP = 3;
const B08_MAX = 34;
const stuckSensors = new Set<string>();
const FAST_FORWARD_DAYS = 30;

const world = buildWorld(envCenter());
let directive: SimDirective = { clock: defaultClock(), inverterH21: false, batteryB08: false, gw3Offline: false, cloudy: false, cloudySoiled: false, fastForward: false, repaired: [], resetEpoch: 0 };
let seq = Math.floor(Date.now() / 1000);
let engine: Engine;
let lastT = 0;
let tick = 0;
let b08Heat = 0;
let lastEpoch = 0;
const buffer: TelemetryMessage[] = [];

function faultsFor(day: number): Fault[] {
  const today = dayStart(day);
  const list = defaultFaults(today);
  if (directive.inverterH21) list.push({ kind: "inverter_trip", assetId: "H21", from: today });
  return list.filter((f) => !directive.repaired.includes(f.assetId));
}

function warm(t: number) {
  const day = wibDay(t);
  const today = dayStart(day);
  engine = new Engine({ world, faults: faultsFor(day), refDayStart: today, demoDay: day });
  // Seed and simulator start 35 days back so that battery state at t matches the seeded history.
  engine.warmUp(today - 35 * DAY, t);
  lastT = t;
}

const iso = (ts: number) => new Date((ts + 7 * 3600) * 1000).toISOString().replace("Z", "+07:00");
const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

function jitter(index: number, salt: number, span: number): number {
  return 1 + (hash01(index, tick, salt) - 0.5) * span;
}

function buildMessages(s: WorldSample, zoneIdx: number, buffered: boolean): TelemetryMessage[] {
  const zoneId = ZONE_IDS[zoneIdx - 1];
  const gatewayId = `GW-${zoneIdx}`;
  const ts = iso(s.ts);
  const zone = s.zones.find((g) => g.id === zoneId);
  const out: TelemetryMessage[] = [];
  const gJ = jitter(zoneIdx, 1, 0.012);
  if (zone) {
    out.push({
      type: "meter", deviceId: `MTR-${zoneId}-01`, assetId: zoneId, gatewayId, ts, seq, buffered,
      metrics: {
        pvW: round(zone.pvW * gJ), loadW: round(zone.loadW * jitter(zoneIdx, 2, 0.01)), plnImportW: round(zone.plnW),
        chargeW: round(zone.chargeW), dischargeW: round(zone.dischargeW), curtailW: round(zone.curtailW),
        irradiance: round(s.g * gJ), ambientC: round(s.ambient),
      },
    });
  }
  for (const p of s.pv) {
    if (p.zoneId !== zoneId || p.offline) continue;
    const idx = Number(p.id.slice(1));
    const j = gJ * jitter(idx, 3, 0.008);
    out.push({
      type: "pv", deviceId: `PV-${p.id}-01`, assetId: p.id, gatewayId, ts, seq, buffered,
      metrics: { dcVoltage: round(p.dcV * jitter(idx, 4, 0.004)), dcCurrent: round(p.dcI * j), acPowerW: round(p.acW * j), panelTempC: round(p.tempC), irradiance: stuckSensors.has(p.id) ? round(p.sensorIrradiance) : round(p.sensorIrradiance * gJ) },
      status: { inverter: p.inverter, rssi: -58 - Math.floor(hash01(idx, 1) * 30) },
    });
  }
  for (const b of s.batteries) {
    if (b.zoneId !== zoneId) continue;
    const idx = Number(b.id.slice(1));
    const heated = b.id === "B08" ? b08Heat : 0;
    const tempC = b.tempC + heated + (hash01(idx, tick, 5) - 0.5) * 0.15;
    out.push({
      type: "battery", deviceId: `BAT-${b.id}-01`, assetId: b.id, gatewayId, ts, seq, buffered,
      metrics: {
        voltage: round(b.voltage), currentA: round(b.currentA * jitter(idx, 6, 0.02)), soc: round(b.soc), soh: round(b.soh),
        tempC: round(tempC), spreadMv: round(b.spreadMv * jitter(idx, 7, 0.02)), cycles: round(b.cycles, 0),
      },
      status: { bms: heated > 15 ? "ALARM" : b.bms, rssi: -55 - Math.floor(hash01(idx, 2) * 25) },
    });
  }
  return out;
}

async function post(gatewayId: string, messages: unknown[]): Promise<void> {
  const res = await fetch(`${BASE}/api/v1/ingest`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-gateway-key": gatewayKey(gatewayId, SECRET) },
    body: JSON.stringify({ gatewayId, messages }),
  });
  if (!res.ok) throw new Error(`ingest ${gatewayId}: ${res.status}`);
  const body = (await res.json()) as { directive: SimDirective };
  directive = body.directive;
}

async function fetchDirective(): Promise<void> {
  const res = await fetch(`${BASE}/api/v1/sim/state`, { headers: { "x-gateway-key": gatewayKey("GW-1", SECRET) } });
  if (res.ok) directive = (await res.json()) as SimDirective;
}

async function runTick(): Promise<void> {
  const t = simNow(directive.clock);
  if (directive.resetEpoch !== lastEpoch) {
    lastEpoch = directive.resetEpoch;
    b08Heat = 0;
    buffer.length = 0;
  }
  if (!engine || Math.abs(t - lastT) > 900 || wibDay(t) !== wibDay(lastT)) warm(t);
  engine.setFaults(faultsFor(wibDay(t)));
  engine.cloudOverride = directive.cloudy ? CLOUD_FACTOR : null;
  engine.ageShiftDays = directive.fastForward ? FAST_FORWARD_DAYS : 0;
  b08Heat = directive.batteryB08 ? Math.min(B08_MAX, b08Heat + B08_STEP) : 0;

  const dt = Math.max(0, t - lastT);
  lastT = t;
  const sample = engine.step(t, dt);
  tick += 1;
  seq += 1;

  const sends: Promise<void>[] = [];
  for (let g = 1; g <= 3; g++) {
    const gatewayId = `GW-${g}`;
    if (g === 3 && directive.gw3Offline) {
      buffer.push(...buildMessages(sample, g, true));
      if (buffer.length > BUFFER_LIMIT) buffer.splice(0, buffer.length - BUFFER_LIMIT);
      continue;
    }
    sends.push((async () => {
      if (g === 3 && buffer.length > 0) {
        // Burst re-sync: older buffered records first, in order, then live data.
        const pending = buffer.splice(0, buffer.length);
        for (let i = 0; i < pending.length; i += 2000) await post(gatewayId, pending.slice(i, i + 2000));
      }
      await post(gatewayId, buildMessages(sample, g, false));
    })());
  }
  const results = await Promise.allSettled(sends);
  const failed = results.find((r) => r.status === "rejected");
  if (failed && failed.status === "rejected") throw failed.reason;
  // With only GW-3 offline the others still return directives, so this covers all-offline cases only.
  if (sends.length === 0) await fetchDirective();
}

async function main() {
  console.log(`SUNPULSE simulator -> ${BASE} (tick ${TICK_MS} ms)`);
  let failing = false;
  for (;;) {
    const began = Date.now();
    try {
      await runTick();
      if (failing) console.log("Server tersambung.");
      failing = false;
    } catch (err) {
      if (!failing) console.log(`Menunggu server: ${err instanceof Error ? err.message : String(err)}`);
      failing = true;
    }
    await new Promise((r) => setTimeout(r, Math.max(100, TICK_MS - (Date.now() - began))));
  }
}

void main();
