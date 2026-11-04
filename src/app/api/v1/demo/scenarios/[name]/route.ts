import { NextResponse } from "next/server";
import { ApiError, requireUser, route } from "@/lib/api";
import { SCENARIOS, type ScenarioName } from "@/lib/contracts/telemetry";
import { live } from "@/lib/live/store";

export const POST = route(async (_req: Request, ctx: { params: Promise<{ name: string }> }) => {
  await requireUser("demo:control");
  if (process.env.DEMO_MODE !== "true") throw new ApiError(403, "Mode demo tidak aktif.");
  const { name } = await ctx.params;
  if (!SCENARIOS.includes(name as ScenarioName)) throw new ApiError(404, "Skenario tidak dikenal.");
  await live.scenario(name as ScenarioName);
  return NextResponse.json({ ok: true, directive: live.directive });
});
