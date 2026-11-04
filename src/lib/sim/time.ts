export const WIB_OFFSET = 7 * 3600;
export const DAY = 86400;

export const wibDay = (ts: number): number => Math.floor((ts + WIB_OFFSET) / DAY);
export const dayStart = (day: number): number => day * DAY - WIB_OFFSET;
export const secondOfDay = (ts: number): number => ((ts + WIB_OFFSET) % DAY + DAY) % DAY;
export const hourOfDay = (ts: number): number => secondOfDay(ts) / 3600;

export type ClockMode = "locked" | "real";
export interface ClockConfig {
  mode: ClockMode;
  lockAt: string; // "HH:MM" in WIB
}

export function lockSeconds(lockAt: string): number {
  const [h, m] = lockAt.split(":").map(Number);
  return (h || 0) * 3600 + (m || 0) * 60;
}

/** Simulation time in epoch seconds. In locked mode it stays at lockAt WIB on today's date. */
export function simNow(clock: ClockConfig, realNow = Math.floor(Date.now() / 1000)): number {
  if (clock.mode === "real") return realNow;
  return dayStart(wibDay(realNow)) + lockSeconds(clock.lockAt);
}

export function defaultClock(): ClockConfig {
  return {
    mode: process.env.SIM_CLOCK_MODE === "real" ? "real" : "locked",
    lockAt: process.env.SIM_CLOCK_LOCK_AT ?? "10:15",
  };
}
