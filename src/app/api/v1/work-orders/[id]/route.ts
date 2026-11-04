import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, requireUser, route } from "@/lib/api";
import { prisma } from "@/lib/db";
import { live } from "@/lib/live/store";
import { inScope } from "@/lib/rbac";
import { simNow } from "@/lib/sim/time";

const body = z.object({ status: z.enum(["in_progress", "done"]) });

export const PATCH = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser("workorders:update");
  const { id } = await ctx.params;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "Status tidak valid.");
  await live.init();
  const order = await prisma.workOrder.findUnique({ where: { id } });
  if (!order || !inScope(user, order.gangId)) throw new ApiError(404, "Perintah kerja tidak ditemukan.");
  const done = parsed.data.status === "done";
  await prisma.workOrder.update({
    where: { id },
    data: { status: parsed.data.status, completedAt: done ? simNow(live.clock) : null },
  });
  if (order.alertId) {
    await live.setAlertStatus(order.alertId, done ? "resolved" : "in_progress", user.name);
  }
  if (done) await live.repair(order.assetId);
  return NextResponse.json({ ok: true });
});
