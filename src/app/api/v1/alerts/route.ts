import { NextResponse } from "next/server";
import { requireUser, route } from "@/lib/api";
import { listAlerts } from "@/lib/alerts/query";

export const GET = route(async (req: Request) => {
  const user = await requireUser();
  const url = new URL(req.url);
  const alerts = await listAlerts(user, {
    active: url.searchParams.get("active") === "true",
    gangId: url.searchParams.get("gangId"),
    assetId: url.searchParams.get("assetId"),
    limit: Math.min(Number(url.searchParams.get("limit") ?? 200) || 200, 500),
  });
  return NextResponse.json({ alerts });
});
