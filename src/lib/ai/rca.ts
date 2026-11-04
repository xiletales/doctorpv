/**
 * Root cause scoring. Each cause starts from a prior and each observed symptom multiplies
 * it by a likelihood ratio, then the results are normalised. This keeps every probability
 * traceable to the listed evidence. The factors are engineering judgement, not trained weights.
 */
export interface Cause {
  key: string;
  label: string;
  probability: number;
  evidence: string[];
  action: string;
}

export interface Diagnosis {
  causes: Cause[];
  confidence: number;
  summary: string;
}

interface CauseDef {
  key: string;
  label: string;
  prior: number;
  action: string;
}

interface Symptom {
  when: boolean;
  evidence: string;
  /** Multiplier applied to each listed cause. Others stay unchanged. */
  lr: Record<string, number>;
}

function score(defs: CauseDef[], symptoms: Symptom[]): Diagnosis {
  const weights = new Map(defs.map((d) => [d.key, d.prior]));
  const evidence = new Map<string, string[]>(defs.map((d) => [d.key, []]));
  for (const s of symptoms) {
    if (!s.when) continue;
    for (const [key, lr] of Object.entries(s.lr)) {
      weights.set(key, (weights.get(key) ?? 0) * lr);
      if (lr > 1) evidence.get(key)?.push(s.evidence);
    }
  }
  const total = [...weights.values()].reduce((a, b) => a + b, 0) || 1;
  const causes = defs
    .map((d) => ({
      key: d.key,
      label: d.label,
      action: d.action,
      probability: (weights.get(d.key) ?? 0) / total,
      evidence: evidence.get(d.key) ?? [],
    }))
    .sort((a, b) => b.probability - a.probability);
  return {
    causes,
    confidence: causes[0].probability,
    summary: `Penyebab paling mungkin: ${causes[0].label.toLowerCase()} (estimasi ${Math.round(causes[0].probability * 100)}%).`,
  };
}

export interface PvFeatures {
  ratioNow: number;
  peerRatioNow: number;
  irradiance: number;
  dcVoltage: number;
  dcCurrent: number;
  acPowerW: number;
  inverterTrip: boolean;
  /** Change in the daily performance ratio per day across recent days. */
  trendPerDay: number;
  /** Days since performance was last in line with peers. */
  daysDegraded: number;
  /** True when low output repeats in the same hours and other hours stay normal. */
  recurringHours: boolean;
  /** True when the drop appeared within the latest day. */
  abrupt: boolean;
}

const PV_CAUSES: CauseDef[] = [
  { key: "inverter", label: "Gangguan inverter", prior: 0.2, action: "Periksa status dan kode kesalahan inverter, lalu nyalakan ulang sesuai prosedur." },
  { key: "soiling", label: "Panel kotor atau penurunan kinerja", prior: 0.3, action: "Bersihkan panel, lalu bandingkan produksi sebelum dan sesudahnya." },
  { key: "shading", label: "Bayangan parsial", prior: 0.2, action: "Periksa objek peneduh pada jam produksi turun, seperti pohon atau bangunan baru." },
  { key: "sensor", label: "Anomali sensor pengukuran", prior: 0.15, action: "Verifikasi pembacaan dengan alat ukur sebelum menyimpulkan PV rusak." },
  { key: "wiring", label: "Masalah kabel atau konektor", prior: 0.15, action: "Periksa konektor DC, sambungan string, dan pengaman." },
];

export function diagnosePv(f: PvFeatures): Diagnosis {
  const dcPower = f.dcVoltage * f.dcCurrent;
  const atZero = f.acPowerW < 20;
  const sun = f.irradiance >= 150;
  return score(PV_CAUSES, [
    {
      when: f.inverterTrip,
      evidence: "Inverter melaporkan status TRIP.",
      lr: { inverter: 12, sensor: 0.3, soiling: 0.1, shading: 0.1 },
    },
    {
      when: atZero && sun && f.dcVoltage > 100 && f.dcCurrent < 0.5,
      evidence: `Output AC nol pada iradiasi ${Math.round(f.irradiance)} W/m² sementara tegangan DC tetap ${Math.round(f.dcVoltage)} V.`,
      lr: { inverter: 8, wiring: 1.5, soiling: 0.1, shading: 0.2 },
    },
    {
      when: atZero && sun && f.dcVoltage < 20,
      evidence: "Tegangan DC tidak terbaca padahal iradiasi tinggi.",
      lr: { wiring: 10, sensor: 2, inverter: 0.4, soiling: 0.05, shading: 0.1 },
    },
    {
      when: atZero && dcPower > 100,
      evidence: `Sensor AC membaca nol, tetapi daya DC terukur sekitar ${Math.round(dcPower)} W.`,
      lr: { sensor: 15, inverter: 0.3, soiling: 0.1, shading: 0.2 },
    },
    {
      when: f.abrupt && atZero,
      evidence: "Penurunan terjadi tiba-tiba dalam satu hari terakhir.",
      lr: { inverter: 2.5, wiring: 2, soiling: 0.2 },
    },
    {
      when: f.trendPerDay < -0.004 && f.daysDegraded >= 5,
      evidence: `Rasio kinerja menurun bertahap ${Math.abs(f.trendPerDay * 100).toFixed(1).replace(".", ",")}% per hari selama ${f.daysDegraded} hari.`,
      lr: { soiling: 8, shading: 0.7, inverter: 0.2, sensor: 0.3 },
    },
    {
      when: f.peerRatioNow > 0.9 && f.ratioNow < 0.85 * f.peerRatioNow,
      evidence: `Rumah lain di gang yang sama normal (${Math.round(f.peerRatioNow * 100)}% dari ekspektasi), sehingga cuaca bukan penyebabnya.`,
      lr: { soiling: 1.6, inverter: 1.2, shading: 1.4, wiring: 1.2 },
    },
    {
      when: f.recurringHours,
      evidence: "Produksi turun berulang pada jam yang sama setiap hari, sedangkan jam lain normal.",
      lr: { shading: 12, soiling: 0.3, inverter: 0.3 },
    },
    {
      when: !atZero && f.ratioNow > 0.3,
      evidence: "Panel masih menghasilkan daya, hanya di bawah ekspektasi.",
      lr: { soiling: 1.5, shading: 1.3, inverter: 0.3, sensor: 0.5 },
    },
  ]);
}

export interface BatteryFeatures {
  tempC: number;
  ambientC: number;
  peerTempC: number;
  /** °C per observed sample window. */
  tempRisePerMin: number;
  currentA: number;
  spreadMv: number;
  soh: number;
  bmsAlarm: boolean;
  /** Share of recent samples with a temperature step too large to be physical. */
  implausibleSteps: boolean;
}

const BATTERY_CAUSES: CauseDef[] = [
  { key: "thermal", label: "Tekanan termal", prior: 0.25, action: "Kurangi arus, periksa ventilasi kabinet, dan ukur suhu modul secara manual." },
  { key: "imbalance", label: "Ketidakseimbangan sel", prior: 0.25, action: "Jalankan penyeimbangan BMS dan ukur tegangan tiap sel." },
  { key: "aging", label: "Penuaan baterai", prior: 0.25, action: "Lakukan uji kapasitas dan rencanakan penggantian bila kapasitas terkonfirmasi turun." },
  { key: "sensor", label: "Anomali sensor BMS", prior: 0.25, action: "Bandingkan pembacaan dengan termometer atau multimeter sebelum menyimpulkan kerusakan." },
];

export function diagnoseBattery(f: BatteryFeatures): Diagnosis {
  const peerGap = f.tempC - f.peerTempC;
  return score(BATTERY_CAUSES, [
    {
      when: peerGap > 8,
      evidence: `Suhu ${peerGap.toFixed(1).replace(".", ",")} °C di atas baterai lain di gang yang sama.`,
      lr: { thermal: 5, sensor: 1.3, imbalance: 1.1, aging: 0.7 },
    },
    {
      when: f.tempRisePerMin > 0.5,
      evidence: `Suhu terus naik sekitar ${f.tempRisePerMin.toFixed(1).replace(".", ",")} °C per menit.`,
      lr: { thermal: 4, aging: 0.4, imbalance: 0.8 },
    },
    {
      when: f.bmsAlarm,
      evidence: "BMS mengeluarkan status ALARM.",
      lr: { thermal: 2.5, imbalance: 1.5, sensor: 0.5 },
    },
    {
      when: Math.abs(f.currentA) > 12 && peerGap > 4,
      evidence: `Arus ${Math.abs(f.currentA).toFixed(1).replace(".", ",")} A berlangsung saat suhu tinggi.`,
      lr: { thermal: 1.8 },
    },
    {
      when: f.spreadMv >= 100,
      evidence: `Selisih tegangan antarsel ${Math.round(f.spreadMv)} mV melebihi batas 100 mV.`,
      lr: { imbalance: 14, thermal: 0.4, aging: 0.8, sensor: 0.5 },
    },
    {
      when: f.soh < 80,
      evidence: `SoH ${f.soh.toFixed(1).replace(".", ",")}% berada di bawah ambang akhir masa pakai 80%.`,
      lr: { aging: 16, thermal: 0.4, sensor: 0.3, imbalance: 0.5 },
    },
    {
      when: f.implausibleSteps,
      evidence: "Pembacaan melompat lebih cepat daripada perubahan suhu fisik yang wajar.",
      lr: { sensor: 2.5, thermal: 0.9 },
    },
  ]);
}
