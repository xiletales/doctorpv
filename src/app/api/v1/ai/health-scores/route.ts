import { NextResponse } from "next/server";
import type { HealthRow } from "@/lib/ai/dto";
import { requireUser, route } from "@/lib/api";
import { live } from "@/lib/live/store";
import { gangScope } from "@/lib/rbac";

export const GET = route(async () => {
  const user = await requireUser();
  await live.init();
  const scope = gangScope(user);
  const allow = (g: string) => scope === null || scope.includes(g);
  const rows: HealthRow[] = [];
  for (const p of live.pv.values()) {
    const score = live.health.get(p.id);
    if (score && allow(p.gangId)) rows.push({ id: p.id, type: "pv", gangId: p.gangId, status: p.status, score });
  }
  for (const b of live.batteries.values()) {
    const score = live.health.get(b.id);
    if (score && allow(b.gangId)) rows.push({ id: b.id, type: "battery", gangId: b.gangId, status: b.status, score });
  }
  return NextResponse.json({ rows });
});
