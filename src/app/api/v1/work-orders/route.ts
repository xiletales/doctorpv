import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, requireUser, route } from "@/lib/api";
import { prisma } from "@/lib/db";
import { live } from "@/lib/live/store";
import { simNow } from "@/lib/sim/time";
import type { WorkOrderDto, WorkOrderStatus } from "@/lib/workorder-dto";

const create = z.object({ alertId: z.string().min(1) });

export const GET = route(async () => {
  await requireUser();
  const rows = await prisma.workOrder.findMany({ orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  const orders: WorkOrderDto[] = rows.map((r) => ({
    id: r.id, assetType: r.assetType, assetId: r.assetId, zoneId: r.zoneId, source: r.source, priority: r.priority,
    status: r.status as WorkOrderStatus, title: r.title, assignee: r.assignee, alertId: r.alertId, beforeValue: r.beforeValue,
    createdAt: r.createdAt, completedAt: r.completedAt,
  }));
  return NextResponse.json({ orders });
});

export const POST = route(async (req: Request) => {
  await requireUser("workorders:create");
  const parsed = create.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "Pilih alert yang akan ditindaklanjuti.");
  await live.init();
  const alert = await prisma.alert.findUnique({ where: { id: parsed.data.alertId } });
  if (!alert) throw new ApiError(404, "Alert tidak ditemukan.");
  if (alert.workOrderId) throw new ApiError(409, "Alert ini sudah memiliki perintah kerja.");
  const id = `WO-${Date.now().toString(36).toUpperCase()}`;
  // Stores the reading at creation, so that completion can show a before and after comparison.
  const before = alert.assetType === "pv" ? (live.pv.get(alert.assetId)?.ratio ?? 0) * 100 : live.batteries.get(alert.assetId)?.tempC ?? null;
  await prisma.workOrder.create({
    data: {
      id, assetType: alert.assetType, assetId: alert.assetId, zoneId: alert.zoneId, source: "Alert otomatis", priority: alert.priority,
      status: "new", title: alert.recommendedAction, assignee: "Budi Hartono", alertId: alert.id, beforeValue: before, createdAt: simNow(live.clock),
    },
  });
  await prisma.alert.update({ where: { id: alert.id }, data: { workOrderId: id } });
  return NextResponse.json({ ok: true, id });
});
