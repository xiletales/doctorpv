import { NextResponse } from "next/server";
import type { AnomalyDto } from "@/lib/ai/dto";
import type { AnomalyPayload } from "@/lib/ai/pipeline";
import { requireUser, route } from "@/lib/api";
import { prisma } from "@/lib/db";

export const GET = route(async () => {
  await requireUser();
  const rows = await prisma.aiPrediction.findMany({
    where: { kind: "anomaly" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  const anomalies: AnomalyDto[] = rows.map((r) => ({
    id: r.id, assetType: r.assetType, assetId: r.assetId, zoneId: r.zoneId, confidence: r.confidence,
    modelVersion: r.modelVersion, alertId: r.alertId, createdAt: r.createdAt, payload: JSON.parse(r.payloadJson) as AnomalyPayload,
  }));
  // Ongoing anomalies first, then the most severe. The sort is stable, so newest stays first within each group.
  const rank = { critical: 3, high: 2, medium: 1, low: 0 };
  anomalies.sort((a, b) => Number(b.payload.open) - Number(a.payload.open) || rank[b.payload.severity] - rank[a.payload.severity]);
  return NextResponse.json({ anomalies });
});
