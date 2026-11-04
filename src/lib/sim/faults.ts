import { DAY } from "./time";

export type FaultKind =
  | "soiling"
  | "shading"
  | "inverter_trip"
  | "sensor_stuck_zero"
  | "thermal"
  | "imbalance"
  | "device_offline";

export interface Fault {
  kind: FaultKind;
  assetId: string;
  from: number;
  to?: number;
  /** soiling: final performance factor. shading: factor. thermal: °C. imbalance: mV. */
  magnitude?: number;
  hours?: [number, number];
}

/** The default demo state relative to the start of today (WIB). */
export function defaultFaults(today: number): Fault[] {
  return [
    // Active: these define Gang 2 Waspada, Gang 3 Kritis and the offline device in Gang 4.
    { kind: "soiling", assetId: "H027", from: today - 21 * DAY, magnitude: 0.68 },
    { kind: "inverter_trip", assetId: "H047", from: today + 8.67 * 3600 },
    { kind: "imbalance", assetId: "B028", from: today - 5 * DAY, magnitude: 165 },
    { kind: "device_offline", assetId: "H066", from: today - DAY + 14 * 3600 },
    // History: already over, so they appear only as past anomalies.
    { kind: "soiling", assetId: "H083", from: today - 29 * DAY, to: today - 13 * DAY, magnitude: 0.7 },
    { kind: "shading", assetId: "H012", from: today - 17 * DAY, to: today - 11 * DAY, magnitude: 0.4, hours: [13, 15.5] },
    { kind: "sensor_stuck_zero", assetId: "H072", from: today - 9 * DAY, to: today - 8 * DAY + 6 * 3600 },
    { kind: "inverter_trip", assetId: "H034", from: today - 24 * DAY, to: today - 22 * DAY },
    { kind: "thermal", assetId: "B007", from: today - 20 * DAY, to: today - 19 * DAY, magnitude: 15 },
    { kind: "imbalance", assetId: "B016", from: today - 15 * DAY, to: today - 12 * DAY, magnitude: 150 },
  ];
}

export interface FaultIndex {
  byAsset: Map<string, Fault[]>;
}

export function indexFaults(faults: Fault[]): FaultIndex {
  const byAsset = new Map<string, Fault[]>();
  for (const f of faults) {
    const list = byAsset.get(f.assetId) ?? [];
    list.push(f);
    byAsset.set(f.assetId, list);
  }
  return { byAsset };
}

export function activeFaults(index: FaultIndex, assetId: string, ts: number): Fault[] {
  const list = index.byAsset.get(assetId);
  if (!list) return [];
  return list.filter((f) => ts >= f.from && (f.to === undefined || ts < f.to));
}
