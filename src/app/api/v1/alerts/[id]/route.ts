import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, requireUser, route } from "@/lib/api";
import { prisma } from "@/lib/db";
import { live } from "@/lib/live/store";
import { inScope } from "@/lib/rbac";

const body = z.object({ status: z.enum(["acknowledged", "in_progress", "resolved"]) });

export const PATCH = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser("alerts:write");
  const { id } = await ctx.params;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "Status tidak valid.");
  const alert = await prisma.alert.findUnique({ where: { id }, select: { gangId: true } });
  if (!alert || !inScope(user, alert.gangId)) throw new ApiError(404, "Alert tidak ditemukan.");
  const updated = await live.setAlertStatus(id, parsed.data.status, user.name);
  return NextResponse.json({ ok: true, status: updated?.status });
});
