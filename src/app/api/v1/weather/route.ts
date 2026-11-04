import { NextResponse } from "next/server";
import { requireUser, route } from "@/lib/api";
import { live } from "@/lib/live/store";
import { simNow } from "@/lib/sim/time";

/** The reference judging the telemetry, plus today's real Solo weather as context only. */
export const GET = route(async () => {
  await requireUser();
  await live.init();
  return NextResponse.json(await live.weatherStatus(simNow(live.clock)));
});
