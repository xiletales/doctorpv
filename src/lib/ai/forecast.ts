import { linearRegression } from "./stats";

export const SOH_EOL = 80;

export interface SohForecastPoint {
  ts: number;
  value: number;
  lower: number;
  upper: number;
}

export interface SohForecast {
  slopePerDay: number;
  projection: SohForecastPoint[];
  /** Null when the battery is at or past end of life, or when SoH is not falling. */
  daysToEol: number | null;
  monthsLow: number | null;
  monthsHigh: number | null;
  pastEol: boolean;
  current: number;
}

const DAY = 86400;

/** Linear SoH trend with a 95% prediction band, projected from the last history point. */
export function forecastSoh(history: { ts: number; soh: number }[], horizonDays = 180): SohForecast {
  const base = history[0]?.ts ?? 0;
  const points = history.map((h) => ({ x: (h.ts - base) / DAY, y: h.soh }));
  const reg = linearRegression(points);
  const lastTs = history[history.length - 1]?.ts ?? base;
  const lastX = (lastTs - base) / DAY;
  const current = reg.intercept + reg.slope * lastX;
  const projection: SohForecastPoint[] = [];
  for (let d = 0; d <= horizonDays; d += 7) {
    const x = lastX + d;
    const value = reg.intercept + reg.slope * x;
    const se = reg.residualSd * Math.sqrt(1 + 1 / Math.max(reg.n, 1) + (reg.sxx > 0 ? (x - reg.meanX) ** 2 / reg.sxx : 0));
    projection.push({ ts: lastTs + d * DAY, value, lower: value - 1.96 * se, upper: value + 1.96 * se });
  }
  const pastEol = current <= SOH_EOL;
  const falling = reg.slope < -1e-4;
  const daysToEol = !pastEol && falling ? (SOH_EOL - current) / reg.slope : null;
  // Uncertainty on the slope gives the range of the estimate.
  const seSlope = reg.sxx > 0 ? reg.residualSd / Math.sqrt(reg.sxx) : 0;
  const fast = reg.slope - 1.96 * seSlope;
  const slow = Math.min(reg.slope + 1.96 * seSlope, -1e-4);
  return {
    slopePerDay: reg.slope,
    projection,
    daysToEol,
    monthsLow: daysToEol !== null ? (SOH_EOL - current) / fast / 30.4 : null,
    monthsHigh: daysToEol !== null ? (SOH_EOL - current) / slow / 30.4 : null,
    pastEol,
    current,
  };
}
