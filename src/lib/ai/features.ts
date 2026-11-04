import { expectedPowerW } from "./expected";
import type { DailyPoint } from "./anomaly";
import { hourOfDay, wibDay } from "../sim/time";
import { linearRegression, median } from "./stats";

export interface HourlyPv {
  ts: number;
  acW: number;
}

export interface HourlyWeather {
  ts: number;
  irradiance: number;
  ambientC: number;
}

export interface DayRatio {
  ts: number;
  day: number;
  actualWh: number;
  expectedWh: number;
  ratio: number;
  reportedZeroHours: number;
  sunHours: number;
}

/** Energy against expectation for each day, counting only hours with useful sun. */
export function dailyRatios(rows: HourlyPv[], weather: Map<number, HourlyWeather>, capacityKwp: number, pr: number): DayRatio[] {
  const days = new Map<number, DayRatio>();
  for (const r of rows) {
    const w = weather.get(r.ts);
    if (!w || w.irradiance < 100) continue;
    const day = wibDay(r.ts);
    const d = days.get(day) ?? { ts: r.ts, day, actualWh: 0, expectedWh: 0, ratio: 0, reportedZeroHours: 0, sunHours: 0 };
    d.actualWh += r.acW;
    d.expectedWh += expectedPowerW(capacityKwp, w.irradiance, w.ambientC, pr);
    d.sunHours += 1;
    if (r.acW < 20) d.reportedZeroHours += 1;
    days.set(day, d);
  }
  return [...days.values()]
    .sort((a, b) => a.day - b.day)
    .map((d) => ({ ...d, ratio: d.expectedWh > 0 ? d.actualWh / d.expectedWh : 1 }));
}

export function withPeers(own: DayRatio[], peersByDay: Map<number, number[]>): DailyPoint[] {
  return own.map((d) => ({
    ts: d.ts,
    ratio: d.ratio,
    peerRatio: median(peersByDay.get(d.day) ?? [1]),
    reportedZeroHours: d.reportedZeroHours,
    sunHours: d.sunHours,
  }));
}

/**
 * Baseline PR: the system's own 80th percentile day. A median would learn long degradation
 * such as soiling as normal, and then under-report the loss and over-report the recovery.
 */
export function baselinePr(rows: HourlyPv[], weather: Map<number, HourlyWeather>, capacityKwp: number): number {
  const ratios = dailyRatios(rows, weather, capacityKwp, 1).map((d) => d.ratio).sort((a, b) => a - b);
  return ratios.length ? ratios[Math.floor((ratios.length - 1) * 0.8)] : 0.78;
}

export function trendPerDay(days: { day: number; ratio: number }[], window = 14): number {
  const recent = days.slice(-window);
  if (recent.length < 3) return 0;
  return linearRegression(recent.map((d) => ({ x: d.day, y: d.ratio }))).slope;
}

export function daysDegraded(days: { ratio: number; peerRatio: number }[]): number {
  let n = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].ratio < days[i].peerRatio * 0.95) n += 1;
    else break;
  }
  return n;
}

/** True when the same few hours run low while the rest of the day stays near expectation. */
export function recurringLowHours(rows: HourlyPv[], weather: Map<number, HourlyWeather>, capacityKwp: number, pr: number): boolean {
  const low = new Map<number, number[]>();
  for (const r of rows) {
    const w = weather.get(r.ts);
    if (!w || w.irradiance < 150) continue;
    const h = Math.floor(hourOfDay(r.ts));
    const list = low.get(h) ?? [];
    list.push(r.acW / Math.max(expectedPowerW(capacityKwp, w.irradiance, w.ambientC, pr), 1));
    low.set(h, list);
  }
  const med = [...low.values()].filter((v) => v.length >= 2).map((v) => median(v));
  if (med.length < 5) return false;
  const lowCount = med.filter((m) => m < 0.75).length;
  const okCount = med.filter((m) => m >= 0.9).length;
  return lowCount >= 1 && lowCount <= 4 && okCount >= med.length - 4;
}
