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
  /** Current irradiance over the clear-sky value. Under 0.7 means notably cloudy. */
  clearFraction?: number;
  /** Set when the point's irradiance sensor was not trusted. */
  sensorProblem?: string | null;
}

const PV_CAUSES: CauseDef[] = [
  { key: "cuaca", label: "Cuaca (mendung/hujan)", prior: 0.1, action: "Tidak perlu tindakan. Produksi rendah karena mendung, bukan kerusakan." },
  { key: "inverter", label: "Inverter/koneksi bermasalah", prior: 0.25, action: "Periksa status inverter, konektor DC, dan pengaman, lalu nyalakan ulang sesuai prosedur." },
  { key: "soiling", label: "Panel kotor / degradasi", prior: 0.3, action: "Bersihkan panel, lalu bandingkan produksi sebelum dan sesudahnya." },
  { key: "shading", label: "Bayangan parsial", prior: 0.2, action: "Periksa objek peneduh pada jam produksi turun, seperti pohon atau bangunan baru." },
  { key: "sensor", label: "Sensor perlu verifikasi", prior: 0.15, action: "Verifikasi pembacaan dengan alat ukur sebelum menyimpulkan PV rusak." },
];

export function diagnosePv(f: PvFeatures): Diagnosis {
  const dcPower = f.dcVoltage * f.dcCurrent;
  const atZero = f.acPowerW < 20;
  const sun = f.irradiance >= 150;
  const clear = f.clearFraction ?? 1;
  const cloudy = clear < 0.7;
  const onExpectation = f.ratioNow >= 0.85;
  return score(PV_CAUSES, [
    {
      when: cloudy && onExpectation,
      evidence: `Iradiasi hanya ${Math.round(clear * 100)}% dari hari cerah, dan produksi tetap ${Math.round(f.ratioNow * 100)}% dari ekspektasi sesuai cuaca itu.`,
      lr: { cuaca: 40, soiling: 0.1, shading: 0.2, inverter: 0.05, sensor: 0.2 },
    },
    {
      when: !cloudy || !onExpectation,
      evidence: "Produksi tidak bisa dijelaskan oleh cuaca.",
      lr: { cuaca: 0.02 },
    },
    {
      when: cloudy && !onExpectation,
      evidence: `Di hari mendung pun, produksi ${Math.round((1 - f.ratioNow) * 100)}% di bawah ekspektasi sesuai cuaca, dan di bawah median klaster ${Math.round(f.peerRatioNow * 100)}%.`,
      lr: { soiling: 1.5, shading: 1.2, inverter: 1.2 },
    },
    {
      when: Boolean(f.sensorProblem),
      evidence: `Sensor iradiasi ${f.sensorProblem ?? ""}.`,
      lr: { sensor: 20, soiling: 0.3, shading: 0.3, inverter: 0.3 },
    },
    {
      when: f.inverterTrip,
      evidence: "Inverter melaporkan status TRIP.",
      lr: { inverter: 12, sensor: 0.3, soiling: 0.1, shading: 0.1 },
    },
    {
      when: atZero && sun && f.dcVoltage > 100 && f.dcCurrent < 0.5,
      evidence: `Output AC nol pada iradiasi ${Math.round(f.irradiance)} W/m² sementara tegangan DC tetap ${Math.round(f.dcVoltage)} V.`,
      lr: { inverter: 8, soiling: 0.1, shading: 0.2 },
    },
    {
      when: atZero && sun && f.dcVoltage < 20,
      evidence: "Tegangan DC tidak terbaca padahal iradiasi tinggi.",
      lr: { inverter: 6, sensor: 2, soiling: 0.05, shading: 0.1 },
    },
    {
      when: atZero && dcPower > 100,
      evidence: `Sensor AC membaca nol, tetapi daya DC terukur sekitar ${Math.round(dcPower)} W.`,
      lr: { sensor: 15, inverter: 0.3, soiling: 0.1, shading: 0.2 },
    },
    {
      when: f.abrupt && atZero,
      evidence: "Penurunan terjadi tiba-tiba dalam satu hari terakhir.",
      lr: { inverter: 2.5, soiling: 0.2 },
    },
    {
      when: f.trendPerDay < -0.004 && f.daysDegraded >= 5,
      evidence: `Rasio kinerja menurun bertahap ${Math.abs(f.trendPerDay * 100).toFixed(1).replace(".", ",")}% per hari selama ${f.daysDegraded} hari.`,
      lr: { soiling: 8, shading: 0.7, inverter: 0.2, sensor: 0.3 },
    },
    {
      when: f.peerRatioNow > 0.9 && f.ratioNow < 0.85 * f.peerRatioNow,
      evidence: `Rumah lain di klaster normal (${Math.round(f.peerRatioNow * 100)}% dari ekspektasi), sehingga cuaca bukan penyebabnya.`,
      lr: { soiling: 1.6, inverter: 1.2, shading: 1.4 },
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

export interface ClusterWeatherFeatures {
  clearFraction: number;
  medianRatio: number;
  /** Points below 70% of their clear-sky output. */
  lowCount: number;
  total: number;
  sensorIrradiance: number;
  referenceIrradiance: number;
  referenceLabel: string;
}

/** The verdict for a cluster-wide drop. It uses the same scoring, and it stays an estimate. */
export function diagnoseClusterWeather(f: ClusterWeatherFeatures): Diagnosis {
  const agree = Math.abs(f.sensorIrradiance - f.referenceIrradiance) <= Math.max(100, f.referenceIrradiance * 0.3);
  return score(PV_CAUSES, [
    {
      when: f.lowCount >= f.total * 0.7,
      evidence: `${f.lowCount} dari ${f.total} titik turun bersamaan, jadi penyebabnya bersifat umum, bukan per panel.`,
      lr: { cuaca: 12, soiling: 0.1, shading: 0.1, inverter: 0.1, sensor: 0.3 },
    },
    {
      when: f.medianRatio >= 0.85,
      evidence: `Rasio aktual terhadap ekspektasi sesuai cuaca tetap normal, median ${Math.round(f.medianRatio * 100)}%.`,
      lr: { cuaca: 8, soiling: 0.2, shading: 0.2, inverter: 0.1 },
    },
    {
      when: agree,
      evidence: `Sensor iradiasi (${Math.round(f.sensorIrradiance)} W/m²) sejalan dengan ${f.referenceLabel.toLowerCase()} (${Math.round(f.referenceIrradiance)} W/m²).`,
      lr: { cuaca: 4, sensor: 0.1 },
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
      evidence: `Suhu ${peerGap.toFixed(1).replace(".", ",")} °C di atas baterai lain di klaster.`,
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
