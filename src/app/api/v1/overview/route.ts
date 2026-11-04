import { NextResponse } from "next/server";
import { requireUser, route } from "@/lib/api";
import { buildOverview } from "@/lib/overview";

export const GET = route(async (req: Request) => {
  await requireUser();
  const zone = new URL(req.url).searchParams.get("zoneId");
  return NextResponse.json(await buildOverview(zone));
});
