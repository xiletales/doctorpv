export type HealthBand = "sangat_baik" | "baik" | "perhatian" | "prioritas";

export const BAND_LABEL: Record<HealthBand, string> = {
  sangat_baik: "Sangat baik",
  baik: "Baik",
  perhatian: "Perlu perhatian",
  prioritas: "Pemeriksaan prioritas",
};

export function bandOf(score: number): HealthBand {
  if (score >= 85) return "sangat_baik";
  if (score >= 70) return "baik";
  if (score >= 50) return "perhatian";
  return "prioritas";
}

export interface HealthFactor {
  label: string;
  points: number;
  max: number;
}

export interface HealthScore {
  score: number;
  band: HealthBand;
  factors: HealthFactor[];
}

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);

function build(factors: HealthFactor[]): HealthScore {
  const score = Math.round(factors.reduce((a, f) => a + f.points, 0));
  return { score: Math.max(0, Math.min(100, score)), band: bandOf(score), factors };
}

const factor = (label: string, quality: number, max: number): HealthFactor => ({
  label,
  max,
  points: Math.round(clamp01(quality) * max * 10) / 10,
});

export interface PvHealthInput {
  /** Actual over expected output, where 1 means on target. */
  performanceRatio: number;
  anomalies30d: number;
  /** Share of valid, on-time data from 0 to 1. */
  dataQuality: number;
  openFaultWeight: number;
  ageYears: number;
}

/** Fixed weights: performance 45, open faults 20, anomaly frequency 15, data quality 15, age 5. */
export function pvHealth(i: PvHealthInput): HealthScore {
  return build([
    factor("Kinerja terhadap ekspektasi", (i.performanceRatio - 0.4) / 0.55, 45),
    factor("Gangguan terbuka", 1 - i.openFaultWeight, 20),
    factor("Frekuensi anomali 30 hari", 1 - i.anomalies30d / 4, 15),
    factor("Kualitas data", i.dataQuality, 15),
    factor("Usia sistem", 1 - i.ageYears / 25, 5),
  ]);
}

export interface BatteryHealthInput {
  soh: number;
  tempC: number;
  spreadMv: number;
  cycles: number;
  anomalies30d: number;
  openFaultWeight: number;
}

/** Fixed weights: SoH 40, temperature 15, cell balance 15, open faults 15, cycles 10, anomalies 5. */
export function batteryHealth(i: BatteryHealthInput): HealthScore {
  return build([
    factor("State of Health", (i.soh - 60) / 35, 40),
    factor("Paparan suhu", 1 - (i.tempC - 35) / 25, 15),
    factor("Keseimbangan sel", 1 - (i.spreadMv - 40) / 120, 15),
    factor("Gangguan terbuka", 1 - i.openFaultWeight, 15),
    factor("Jumlah siklus", 1 - i.cycles / 4000, 10),
    factor("Frekuensi anomali 30 hari", 1 - i.anomalies30d / 4, 5),
  ]);
}

export const FAULT_WEIGHT: Record<string, number> = { critical: 1, high: 0.7, medium: 0.4, low: 0.1 };
