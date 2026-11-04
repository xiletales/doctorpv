import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, requireUser, route } from "@/lib/api";
import { live } from "@/lib/live/store";

const body = z.object({ mode: z.enum(["locked", "real"]), lockAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional() });

export const POST = route(async (req: Request) => {
  await requireUser("demo:control");
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "Format waktu tidak valid.");
  await live.setClock({ mode: parsed.data.mode, lockAt: parsed.data.lockAt ?? live.clock.lockAt });
  return NextResponse.json({ ok: true, clock: live.clock });
});
