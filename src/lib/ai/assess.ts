import { GAMMA } from "../sim/physics";
import { median } from "./stats";

export const JUDGE_MIN_IRRADIANCE = 150;
const SENSOR_TOLERANCE = 0.4;
const SENSOR_MIN_GAP = 150;
const STUCK_TICKS = 8;

/** Expected AC power from irradiance, measured panel temperature, kWp, and the system's own baseline PR. */
export function expectedFromPanel(capacityKwp: number, irradiance: number, panelTempC: number, baselinePr: number): number {
  return Math.max(0, capacityKwp * 1000 * (irradiance / 1000) * baselinePr * (1 + GAMMA * (panelTempC - 25)));
}

export interface PointInput {
  id: string;
  acW: number;
  panelTempC: number;
  capacityKwp: number;
  baselinePr: number;
  /** The point's own irradiance sensor. Null when it reports nothing. */
  sensorIrradiance: number | null;
  /** Consecutive identical sensor readings while the sun is up. */
  sensorStuckTicks: number;
}

export type IrradianceSource = "sensor" | "referensi";

export interface PointAssessment {
  id: string;
  irradiance: number;
  source: IrradianceSource;
  /** Why the sensor was not trusted. Null when it was used. */
  sensorProblem: string | null;
  expectedW: number;
  /** Actual over expected, where expected already accounts for the weather. */
  ratio: number;
}

/** The sensor is preferred. A missing, out-of-range, stuck or implausible reading falls back to the reference. */
function checkSensor(p: PointInput, reference: number): string | null {
  const s = p.sensorIrradiance;
  if (s === null || !Number.isFinite(s)) return "tidak mengirim data";
  if (s < -5 || s > 1500) return `di luar rentang fisik (${Math.round(s)} W/m²)`;
  if (reference >= JUDGE_MIN_IRRADIANCE && p.sensorStuckTicks >= STUCK_TICKS) return `nilainya macet di ${Math.round(s)} W/m²`;
  if (Math.abs(s - reference) > Math.max(SENSOR_MIN_GAP, reference * SENSOR_TOLERANCE)) {
    return `membaca ${Math.round(s)} W/m², sedangkan referensi cuaca ${Math.round(reference)} W/m²`;
  }
  return null;
}

export function assessPoints(points: PointInput[], reference: number): { points: PointAssessment[]; peerRatio: number } {
  const assessed = points.map((p): PointAssessment => {
    const sensorProblem = checkSensor(p, reference);
    const irradiance = sensorProblem === null && p.sensorIrradiance !== null ? p.sensorIrradiance : reference;
    const expectedW = expectedFromPanel(p.capacityKwp, irradiance, p.panelTempC, p.baselinePr);
    return { id: p.id, irradiance, source: sensorProblem === null ? "sensor" : "referensi", sensorProblem, expectedW, ratio: expectedW > 1 ? p.acW / expectedW : 1 };
  });
  return { points: assessed, peerRatio: assessed.length ? median(assessed.map((a) => a.ratio)) : 1 };
}

export type PointVerdict = "normal" | "cuaca" | "gangguan" | "sensor" | "belum_dinilai";

export const VERDICT_LABEL: Record<PointVerdict, string> = {
  normal: "Normal",
  cuaca: "Produksi rendah karena cuaca",
  gangguan: "Di bawah ekspektasi cuaca",
  sensor: "Sensor perlu verifikasi",
  belum_dinilai: "Cahaya terlalu rendah untuk dinilai",
};

/** clearFraction is the current irradiance over the clear-sky value. Under 0.7 means notably cloudy. */
export function verdictFor(a: { ratio: number; irradiance: number; sensorProblem: string | null }, clearFraction: number, hasFault: boolean, hasSensorFault: boolean): PointVerdict {
  if (hasSensorFault || a.sensorProblem) return "sensor";
  if (hasFault) return "gangguan";
  if (a.irradiance < JUDGE_MIN_IRRADIANCE) return "belum_dinilai";
  return clearFraction < 0.7 ? "cuaca" : "normal";
}
