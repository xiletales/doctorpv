import { MODEL_VERSION, type Anomaly } from "./anomaly";
import { expectedPowerW } from "./expected";
import { dailyRatios, daysDegraded, recurringLowHours, trendPerDay, withPeers, type HourlyWeather } from "./features";
import { diagnoseBattery, diagnosePv, type BatteryFeatures, type Diagnosis, type PvFeatures } from "./rca";

export { MODEL_VERSION };

/** Stored as AiPrediction.payloadJson with kind "anomaly". */
export interface AnomalyPayload extends Anomaly {
  title: string;
  open: boolean;
  diagnosis: Diagnosis | null;
}

export interface PvHourlyRow {
  ts: number;
  acW: number;
  dcV: number;
  dcI: number;
  inverter: string;
}

export interface PvContext {
  capacityKwp: number;
  baselinePr: number;
  rows: PvHourlyRow[];
  weather: Map<number, HourlyWeather>;
  peersByDay: Map<number, number[]>;
}

/** Builds root-cause features from hourly history up to `at`, with an optional live reading on top. */
export function pvFeatures(
  ctx: PvContext,
  at: number,
  live?: { acW: number; dcV: number; dcI: number; inverter: string; irradiance: number; ambientC: number; peerRatio: number; clearFraction?: number; sensorProblem?: string | null },
): PvFeatures {
  const rows = ctx.rows.filter((r) => r.ts <= at);
  const days = withPeers(dailyRatios(rows, ctx.weather, ctx.capacityKwp, ctx.baselinePr), ctx.peersByDay);
  const ratioDays = days.map((d) => ({ ...d, day: Math.floor(d.ts / 86400) }));
  const recent = rows.slice(-24 * 7);

  let sample = live;
  if (!sample) {
    // The latest hour with useful sun is the freshest evidence, also when the window ends at night.
    const candidates = rows
      .filter((r) => r.ts > at - 86400 * 1.5)
      .map((r) => ({ r, w: ctx.weather.get(r.ts) }))
      .filter((c) => c.w && c.w.irradiance >= 150);
    const best = candidates[candidates.length - 1];
    sample = {
      acW: best?.r.acW ?? 0,
      dcV: best?.r.dcV ?? 0,
      dcI: best?.r.dcI ?? 0,
      inverter: best?.r.inverter ?? "OK",
      irradiance: best?.w?.irradiance ?? 0,
      ambientC: best?.w?.ambientC ?? 28,
      peerRatio: days[days.length - 1]?.peerRatio ?? 1,
    };
  }
  const expected = expectedPowerW(ctx.capacityKwp, sample.irradiance, sample.ambientC, ctx.baselinePr);
  const yesterday = days[days.length - 2];
  return {
    ratioNow: expected > 0 ? sample.acW / expected : 1,
    peerRatioNow: sample.peerRatio,
    irradiance: sample.irradiance,
    dcVoltage: sample.dcV,
    dcCurrent: sample.dcI,
    acPowerW: sample.acW,
    inverterTrip: sample.inverter === "TRIP",
    trendPerDay: trendPerDay(ratioDays),
    daysDegraded: daysDegraded(days),
    recurringHours: recurringLowHours(recent, ctx.weather, ctx.capacityKwp, ctx.baselinePr),
    abrupt: yesterday ? yesterday.ratio > 0.85 * yesterday.peerRatio : true,
    clearFraction: sample.clearFraction ?? 1,
    sensorProblem: sample.sensorProblem ?? null,
  };
}

export const runPvDiagnosis = (f: PvFeatures): Diagnosis => diagnosePv(f);
export const runBatteryDiagnosis = (f: BatteryFeatures): Diagnosis => diagnoseBattery(f);

const PV_TITLE: Record<Anomaly["pattern"], string> = {
  sudden_zero: "Produksi PV anjlok mendadak",
  gradual: "Produksi PV menurun bertahap",
  partial: "Produksi PV di bawah rumah sekitar",
  reported_zero: "Sensor daya membaca nol",
  sensor: "Pembacaan sensor tidak konsisten",
  thermal: "Suhu baterai naik tidak wajar",
  imbalance: "Tegangan antarsel tidak seimbang",
  aging: "SoH di bawah ambang akhir masa pakai",
  weather: "Produksi rendah karena cuaca, bukan kerusakan",
};

export const anomalyTitle = (pattern: Anomaly["pattern"]): string => PV_TITLE[pattern];
