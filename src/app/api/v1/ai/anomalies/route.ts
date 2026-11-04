import { NextResponse } from "next/server";
import type { AnomalyDto } from "@/lib/ai/dto";
import type { AnomalyPayload } from "@/lib/ai/pipeline";
import { requireUser, route } from "@/lib/api";
import { prisma } from "@/lib/db";
import { gangScope } from "@/lib/rbac";

export const GET = route(async () => {
  const user = await requireUser();
  const scope = gangScope(user);
  const rows = await prisma.aiPrediction.findMany({
    where: { kind: "anomaly", ...(scope ? { gangId: { in: scope } } : {}) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  const anomalies: AnomalyDto[] = rows.map((r) => ({
    id: r.id, assetType: r.assetType, assetId: r.assetId, gangId: r.gangId, confidence: r.confidence,
    modelVersion: r.modelVersion, alertId: r.alertId, createdAt: r.createdAt, payload: JSON.parse(r.payloadJson) as AnomalyPayload,
  }));
  // Ongoing anomalies first, then the newest. The sort is stable, so createdAt order holds within each group.
  anomalies.sort((a, b) => Number(b.payload.open) - Number(a.payload.open));
  return NextResponse.json({ anomalies });
});
