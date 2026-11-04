import type { AlertPriority } from "@/lib/types";

export const THRESHOLDS = {
  minIrradiance: 150,
  productionRatio: 0.8,
  peerFraction: 0.85,
  tripRatio: 0.1,
  tempHigh: 45,
  tempCritical: 55,
  spreadHigh: 120,
  socLow: 10,
  sohEol: 80,
};

export type AlertType =
  | "inverter_trip"
  | "production_drop"
  | "sensor_suspect"
  | "battery_temp"
  | "cell_imbalance"
  | "low_soc"
  | "soh_degradation"
  | "device_offline"
  | "gateway_offline"
  | "weather_info";

export const ALERT_TYPE_LABEL: Record<AlertType, string> = {
  inverter_trip: "Gangguan PV",
  production_drop: "Produksi turun",
  sensor_suspect: "Sensor perlu verifikasi",
  battery_temp: "Suhu baterai abnormal",
  cell_imbalance: "Anomali baterai",
  low_soc: "SoC rendah",
  soh_degradation: "Degradasi SoH",
  device_offline: "Sensor tidak merespons",
  gateway_offline: "Gateway terputus",
  weather_info: "Info cuaca",
};

export interface Condition {
  type: AlertType;
  priority: AlertPriority;
  message: string;
  recommendedAction: string;
}

const id1 = (v: number) => v.toFixed(1).replace(".", ",");

export interface PvReading {
  id: string;
  acW: number;
  dcV: number;
  dcI: number;
  inverter: string;
  ratio: number;
}

/**
 * Decision rule: ratio is actual over an expectation that already accounts for the weather, so low
 * absolute output alone never raises a fault. A fault also has to sit below the peer median.
 * Returns null when there is too little sun to judge, so that existing alerts are kept as they are.
 */
export function evaluatePv(r: PvReading, irradiance: number, peerRatio = 1): Condition[] | null {
  if (irradiance < THRESHOLDS.minIrradiance) return null;
  const dcPower = r.dcV * r.dcI;
  if (r.acW < 20 && dcPower > 100) {
    return [{
      type: "sensor_suspect",
      priority: "medium",
      message: `Sensor AC ${r.id} membaca nol, sedangkan daya DC sekitar ${Math.round(dcPower)} W.`,
      recommendedAction: "Verifikasi sensor dengan alat ukur. Jangan simpulkan PV rusak sebelum diperiksa.",
    }];
  }
  if (r.ratio < THRESHOLDS.tripRatio) {
    return [{
      type: "inverter_trip",
      priority: "critical",
      message: `${r.id} berhenti berproduksi pada iradiasi ${Math.round(irradiance)} W/m².`,
      recommendedAction: "Jadwalkan inspeksi inverter dan koneksi hari ini.",
    }];
  }
  if (r.ratio < THRESHOLDS.productionRatio && r.ratio < THRESHOLDS.peerFraction * peerRatio) {
    return [{
      type: "production_drop",
      priority: "medium",
      message: `Produksi ${r.id} ${Math.round((1 - r.ratio) * 100)}% di bawah ekspektasi sesuai cuaca saat ini, dan di bawah median klaster.`,
      recommendedAction: "Periksa kebersihan panel dan bayangan di sekitar atap.",
    }];
  }
  return [];
}

export function evaluateIrradianceSensor(id: string, problem: string | null): Condition | null {
  if (!problem) return null;
  return {
    type: "sensor_suspect",
    priority: "medium",
    message: `Sensor iradiasi ${id} ${problem}. Ekspektasi sementara memakai referensi cuaca.`,
    recommendedAction: "Verifikasi sensor iradiasi di lokasi. Ini bukan tanda panel rusak.",
  };
}

/** Cluster-wide information, not a fault: output is low, and it is what the weather predicts. */
export function evaluateWeather(input: { clearFraction: number; clearSkyW: number; medianRatio: number; lowShare: number }): Condition | null {
  if (input.clearSkyW < 200 || input.clearFraction >= 0.7 || input.medianRatio < 0.85) return null;
  return {
    type: "weather_info",
    priority: "low",
    message: `Produksi klaster rendah karena cuaca: iradiasi ${Math.round(input.clearFraction * 100)}% dari hari cerah. Bukan kerusakan.`,
    recommendedAction: "Tidak perlu tindakan. Tiap titik tetap dinilai terhadap ekspektasi sesuai cuaca.",
  };
}

export interface BatteryReading {
  id: string;
  tempC: number;
  spreadMv: number;
  soc: number;
  soh: number;
}

export function evaluateBattery(r: BatteryReading): Condition[] {
  const out: Condition[] = [];
  if (r.tempC >= THRESHOLDS.tempHigh) {
    const critical = r.tempC >= THRESHOLDS.tempCritical;
    out.push({
      type: "battery_temp",
      priority: critical ? "critical" : "high",
      message: `Suhu ${r.id} mencapai ${id1(r.tempC)} °C.`,
      recommendedAction: critical
        ? "Isolasi baterai dari bus dan kirim teknisi segera."
        : "Kurangi arus dan periksa ventilasi kabinet.",
    });
  }
  if (r.spreadMv >= THRESHOLDS.spreadHigh) {
    out.push({
      type: "cell_imbalance",
      priority: "high",
      message: `Selisih tegangan sel ${r.id} ${Math.round(r.spreadMv)} mV.`,
      recommendedAction: "Jalankan penyeimbangan BMS dan jadwalkan pengukuran tiap sel.",
    });
  }
  if (r.soc < THRESHOLDS.socLow) {
    out.push({
      type: "low_soc",
      priority: "medium",
      message: `SoC ${r.id} tersisa ${id1(r.soc)}%.`,
      recommendedAction: "Periksa strategi pengosongan dan pasokan PLN.",
    });
  }
  if (r.soh < THRESHOLDS.sohEol) {
    out.push({
      type: "soh_degradation",
      priority: "medium",
      message: `SoH ${r.id} ${id1(r.soh)}%, di bawah ambang 80%.`,
      recommendedAction: "Lakukan uji kapasitas dan rencanakan penggantian.",
    });
  }
  return out;
}
