import { median, robustZ } from "./stats";

export const MODEL_VERSION = "doctorpv-ensemble-0.3";

export type AnomalyMethod = "residual" | "robust_z" | "peer" | "stuck_value" | "range" | "threshold";

export interface DailyPoint {
  ts: number;
  /** Actual energy divided by the expected energy from irradiance. */
  ratio: number;
  /** The same ratio for the median peer house in the gang on the same day. */
  peerRatio: number;
  reportedZeroHours: number;
  sunHours: number;
}

export interface Anomaly {
  metric: string;
  methods: AnomalyMethod[];
  from: number;
  to: number;
  deviationPct: number;
  severity: "critical" | "high" | "medium" | "low";
  pattern: "sudden_zero" | "gradual" | "reported_zero" | "partial" | "thermal" | "imbalance" | "aging" | "sensor";
}

function severityFor(deviationPct: number): Anomaly["severity"] {
  const d = Math.abs(deviationPct);
  if (d >= 75) return "critical";
  if (d >= 35) return "high";
  if (d >= 15) return "medium";
  return "low";
}

/**
 * PV ensemble on daily performance. A day is anomalous when the residual against expected
 * energy and the comparison with gang peers agree, or when the robust z-score is extreme.
 * Peer agreement stops overcast days being read as a fault, because all houses share the weather.
 */
export function detectPvAnomalies(days: DailyPoint[], residualLimit = 0.12, minRun = 1): Anomaly[] {
  const out: Anomaly[] = [];
  const history = days.map((d) => d.ratio);
  let runStart = -1;

  const close = (end: number) => {
    if (runStart < 0) return;
    const run = days.slice(runStart, end + 1);
    runStart = -1;
    if (run.length < minRun) return;
    const avgRatio = run.reduce((a, d) => a + d.ratio, 0) / run.length;
    const avgPeer = run.reduce((a, d) => a + d.peerRatio, 0) / run.length;
    const deviationPct = ((avgRatio - avgPeer) / Math.max(avgPeer, 0.01)) * 100;
    const methods: AnomalyMethod[] = ["residual", "peer"];
    if (Math.abs(robustZ(avgRatio, history)) > 3) methods.push("robust_z");
    const zeroShare = run.reduce((a, d) => a + d.reportedZeroHours / Math.max(d.sunHours, 1), 0) / run.length;
    const min = Math.min(...run.map((d) => d.ratio));
    const first = run[0].ratio;
    const last = run[run.length - 1].ratio;
    let pattern: Anomaly["pattern"] = "partial";
    if (zeroShare > 0.6) pattern = "sudden_zero";
    else if (run.length >= 5 && first - last > 0.08 && min === Math.min(last, min)) pattern = "gradual";
    out.push({
      metric: "acPowerW",
      methods,
      from: run[0].ts,
      to: run[run.length - 1].ts,
      deviationPct,
      severity: severityFor(deviationPct),
      pattern,
    });
  };

  // A run survives two clean days, because intermittent faults such as shading can miss cloudy days.
  let lastHit = -1;
  days.forEach((day, i) => {
    const residual = 1 - day.ratio / Math.max(day.peerRatio, 0.01);
    if (residual > residualLimit) {
      if (runStart < 0) runStart = i;
      lastHit = i;
    } else if (runStart >= 0 && i - lastHit >= 3) {
      close(lastHit);
    }
  });
  if (runStart >= 0) close(lastHit);
  return out;
}

export interface BatteryDaily {
  ts: number;
  maxTempC: number;
  maxSpreadMv: number;
  peerMaxTempC: number;
}

export function detectBatteryAnomalies(days: BatteryDaily[]): Anomaly[] {
  const out: Anomaly[] = [];
  const temps = days.map((d) => d.maxTempC - d.peerMaxTempC);
  const scan = (test: (d: BatteryDaily, i: number) => boolean, make: (run: BatteryDaily[]) => Anomaly) => {
    let start = -1;
    days.forEach((d, i) => {
      const hit = test(d, i);
      if (hit && start < 0) start = i;
      if (!hit && start >= 0) {
        out.push(make(days.slice(start, i)));
        start = -1;
      }
    });
    if (start >= 0) out.push(make(days.slice(start)));
  };
  scan(
    (d) => robustZ(d.maxTempC - d.peerMaxTempC, temps, 0.5) > 3.5 && d.maxTempC - d.peerMaxTempC > 4,
    (run) => {
      const peak = Math.max(...run.map((d) => d.maxTempC - d.peerMaxTempC));
      return {
        metric: "tempC",
        methods: ["robust_z", "peer"],
        from: run[0].ts,
        to: run[run.length - 1].ts,
        deviationPct: (peak / Math.max(median(run.map((d) => d.peerMaxTempC)), 1)) * 100,
        severity: peak > 12 ? "high" : "medium",
        pattern: "thermal",
      };
    },
  );
  scan(
    (d) => d.maxSpreadMv >= 100,
    (run) => {
      const peak = Math.max(...run.map((d) => d.maxSpreadMv));
      return {
        metric: "spreadMv",
        methods: ["range", "robust_z"],
        from: run[0].ts,
        to: run[run.length - 1].ts,
        deviationPct: ((peak - 40) / 40) * 100,
        severity: peak >= 120 ? "high" : "medium",
        pattern: "imbalance",
      };
    },
  );
  return out;
}

export interface StuckRun {
  start: number;
  length: number;
  value: number;
}

/** Finds runs where a signal holds one value. expectedActive excludes night-time zeros. */
export function detectStuck(values: number[], expectedActive: boolean[], minRun = 3, eps = 1e-6): StuckRun[] {
  const out: StuckRun[] = [];
  let start = 0;
  for (let i = 1; i <= values.length; i++) {
    const same = i < values.length && Math.abs(values[i] - values[start]) <= eps && expectedActive[i];
    if (!same) {
      const len = i - start;
      if (len >= minRun && expectedActive[start]) out.push({ start, length: len, value: values[start] });
      start = i;
    }
  }
  return out;
}

export function outOfRange(value: number, min: number, max: number): boolean {
  return value < min || value > max || !Number.isFinite(value);
}
