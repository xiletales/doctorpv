import type { Diagnosis } from "../ai/rca";
import type { AlertPriority, AlertStatus } from "../types";
import type { AlertType } from "./rules";

export interface AlertDto {
  id: string;
  assetType: string;
  assetId: string;
  gangId: string;
  type: AlertType;
  priority: AlertPriority;
  message: string;
  recommendedAction: string;
  status: AlertStatus;
  createdAt: number;
  acknowledgedBy: string | null;
  acknowledgedAt: number | null;
  resolvedAt: number | null;
  workOrderId: string | null;
  diagnosis: Diagnosis | null;
}

const RANK: Record<AlertPriority, number> = { critical: 3, high: 2, medium: 1, low: 0 };

export function byPriority(a: AlertDto, b: AlertDto): number {
  return RANK[b.priority] - RANK[a.priority] || b.createdAt - a.createdAt;
}
