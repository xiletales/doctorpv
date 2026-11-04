export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function mad(values: number[]): number {
  const m = median(values);
  return median(values.map((v) => Math.abs(v - m)));
}

/** Robust z-score from the median and MAD. The floor stops a flat history from exaggerating noise. */
export function robustZ(value: number, history: number[], floor = 0.01): number {
  const scale = Math.max(1.4826 * mad(history), floor);
  return (value - median(history)) / scale;
}

export interface Regression {
  slope: number;
  intercept: number;
  residualSd: number;
  meanX: number;
  sxx: number;
  n: number;
}

export function linearRegression(points: { x: number; y: number }[]): Regression {
  const n = points.length;
  const meanX = points.reduce((a, p) => a + p.x, 0) / Math.max(n, 1);
  const meanY = points.reduce((a, p) => a + p.y, 0) / Math.max(n, 1);
  let sxx = 0;
  let sxy = 0;
  for (const p of points) {
    sxx += (p.x - meanX) ** 2;
    sxy += (p.x - meanX) * (p.y - meanY);
  }
  const slope = sxx > 0 ? sxy / sxx : 0;
  const intercept = meanY - slope * meanX;
  const sse = points.reduce((a, p) => a + (p.y - (intercept + slope * p.x)) ** 2, 0);
  return { slope, intercept, residualSd: Math.sqrt(sse / Math.max(n - 2, 1)), meanX, sxx, n };
}
