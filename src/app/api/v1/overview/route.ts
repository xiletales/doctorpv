import { NextResponse } from "next/server";
import { requireUser, route } from "@/lib/api";
import { buildOverview } from "@/lib/overview";

export const GET = route(async (req: Request) => {
  const user = await requireUser();
  const gang = new URL(req.url).searchParams.get("gangId");
  return NextResponse.json(await buildOverview(user, gang));
});
