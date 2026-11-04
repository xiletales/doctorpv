import { NextResponse } from "next/server";
import type { HealthRow } from "@/lib/ai/dto";
import { requireUser, route } from "@/lib/api";
import { live } from "@/lib/live/store";

export const GET = route(async () => {
  await requireUser();
  await live.init();
  const rows: HealthRow[] = [];
  for (const p of live.pv.values()) {
    const score = live.health.get(p.id);
    if (score) rows.push({ id: p.id, type: "pv", zoneId: p.zoneId, status: p.status, score });
  }
  for (const b of live.batteries.values()) {
    const score = live.health.get(b.id);
    if (score) rows.push({ id: b.id, type: "battery", zoneId: b.zoneId, status: b.status, score });
  }
  return NextResponse.json({ rows });
});
