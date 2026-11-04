import { NextResponse } from "next/server";
import { ApiError, requireUser, route } from "@/lib/api";
import { live } from "@/lib/live/store";

/** Recent live samples held in memory: last 90 ticks, about 3 minutes. */
export const GET = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireUser();
  const { id } = await ctx.params;
  await live.init();
  const zoneId = live.pv.get(id)?.zoneId ?? live.batteries.get(id)?.zoneId;
  if (!zoneId) throw new ApiError(404, "Aset tidak ditemukan.");
  return NextResponse.json({ ring: live.rings.get(id) ?? [] });
});
