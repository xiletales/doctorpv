import type { AnomalyPayload } from "../ai/pipeline";
import { prisma } from "../db";
import { gangScope } from "../rbac";
import type { AlertPriority, AlertStatus, SessionUser } from "../types";
import type { AlertType } from "./rules";

export type { AlertDto } from "./dto";
import type { AlertDto } from "./dto";

export async function listAlerts(
  user: SessionUser,
  opts: { active?: boolean; gangId?: string | null; assetId?: string | null; limit?: number } = {},
): Promise<AlertDto[]> {
  const scope = gangScope(user);
  const gangs = opts.gangId ? (scope === null || scope.includes(opts.gangId) ? [opts.gangId] : []) : scope;
  const rows = await prisma.alert.findMany({
    where: {
      ...(opts.active ? { status: { not: "resolved" } } : {}),
      ...(opts.assetId ? { assetId: opts.assetId } : {}),
      ...(gangs ? { gangId: { in: gangs } } : {}),
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
    gangId: r.gangId,
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

