import { NextResponse } from "next/server";
import { ApiError, requireUser, route } from "@/lib/api";
import { live } from "@/lib/live/store";
import { inScope } from "@/lib/rbac";

/** Recent live samples held in memory: last 90 ticks, about 3 minutes. */
export const GET = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  await live.init();
  const gangId = live.pv.get(id)?.gangId ?? live.batteries.get(id)?.gangId;
  if (!gangId || !inScope(user, gangId)) throw new ApiError(404, "Aset tidak ditemukan.");
  return NextResponse.json({ ring: live.rings.get(id) ?? [] });
});
