import type { AlertPriority } from "@/lib/types";

export const THRESHOLDS = {
  minIrradiance: 150,
  productionRatio: 0.8,
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
  | "gateway_offline";

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

/** Returns null when there is too little sun to judge, so that existing alerts are kept as they are. */
export function evaluatePv(r: PvReading, irradiance: number): Condition[] | null {
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
      recommendedAction: "Jadwalkan inspeksi inverter hari ini.",
    }];
  }
  if (r.ratio < THRESHOLDS.productionRatio) {
    return [{
      type: "production_drop",
      priority: "medium",
      message: `Produksi ${r.id} ${Math.round((1 - r.ratio) * 100)}% di bawah ekspektasi.`,
      recommendedAction: "Periksa kebersihan panel dan bayangan di sekitar atap.",
    }];
  }
  return [];
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
