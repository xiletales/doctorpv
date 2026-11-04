import type { HealthScore } from "./health";
import type { AnomalyPayload } from "./pipeline";

export interface AnomalyDto {
  id: string;
  assetType: string;
  assetId: string;
  zoneId: string;
  confidence: number;
  modelVersion: string;
  alertId: string | null;
  createdAt: number;
  payload: AnomalyPayload;
}

export interface AnomalySeries {
  kind: "ratio" | "tempC" | "spreadMv" | "soh" | "none";
  label: string;
  unit: string;
  points: { ts: number; value: number; peer?: number }[];
  from: number;
  to: number;
}

export interface HealthRow {
  id: string;
  type: "pv" | "battery";
  zoneId: string;
  status: string;
  score: HealthScore;
}
