import type { AssetStatus } from "../types";

export interface PulseInput {
  health: number[];
  statuses: AssetStatus[];
  simulatorConnected: boolean;
}

export interface PulseScore {
  score: number;
  level: "normal" | "warning" | "critical";
  /** Heartbeats per minute for the animated line: faster as health degrades. */
  bpm: number;
}

/**
 * One number for the whole cluster: the mean asset health score, minus a penalty for each
 * active fault, because an average alone hides one failed asset among 45.
 */
export function pulseScore(input: PulseInput): PulseScore {
  const n = input.health.length;
  if (n === 0) return { score: 0, level: "warning", bpm: 60 };
  const mean = input.health.reduce((a, b) => a + b, 0) / n;
  const count = (s: AssetStatus) => input.statuses.filter((x) => x === s).length;
  const penalty = count("critical") * 6 + count("warning") * 2 + count("offline") * 1.5;
  const score = Math.round(Math.max(0, Math.min(100, mean - penalty)));
  const level = count("critical") > 0 ? "critical" : count("warning") + count("offline") > 0 ? "warning" : "normal";
  return { score, level, bpm: level === "critical" ? 120 : level === "warning" ? 84 : 60 };
}
