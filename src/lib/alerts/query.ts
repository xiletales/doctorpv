import type { AnomalyPayload } from "../ai/pipeline";
import { prisma } from "../db";
import type { AlertPriority, AlertStatus } from "../types";
import type { AlertType } from "./rules";

export type { AlertDto } from "./dto";
import type { AlertDto } from "./dto";

export async function listAlerts(
  opts: { active?: boolean; zoneId?: string | null; assetId?: string | null; limit?: number } = {},
): Promise<AlertDto[]> {
  const rows = await prisma.alert.findMany({
    where: {
      ...(opts.active ? { status: { not: "resolved" } } : {}),
      ...(opts.assetId ? { assetId: opts.assetId } : {}),
      ...(opts.zoneId ? { zoneId: opts.zoneId } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: opts.limit ?? 200,
  });
  const preds = await prisma.aiPrediction.findMany({
    where: { alertId: { in: rows.map((r) => r.id) } },
    select: { alertId: true, payloadJson: true },
  });
  const byAlert = new Map(preds.map((p) => [p.alertId, (JSON.parse(p.payloadJson) as AnomalyPayload).diagnosis]));
  return rows.map((r) => ({
    id: r.id,
    assetType: r.assetType,
    assetId: r.assetId,
    zoneId: r.zoneId,
    type: r.type as AlertType,
    priority: r.priority as AlertPriority,
    message: r.message,
    recommendedAction: r.recommendedAction,
    status: r.status as AlertStatus,
    createdAt: r.createdAt,
    acknowledgedBy: r.acknowledgedBy,
    acknowledgedAt: r.acknowledgedAt,
    resolvedAt: r.resolvedAt,
    workOrderId: r.workOrderId,
    diagnosis: byAlert.get(r.id) ?? null,
  }));
}

