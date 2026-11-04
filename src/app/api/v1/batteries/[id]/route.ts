import { NextResponse } from "next/server";
import { forecastSoh } from "@/lib/ai/forecast";
import type { AnomalyPayload } from "@/lib/ai/pipeline";
import { median } from "@/lib/ai/stats";
import { listAlerts } from "@/lib/alerts/query";
import { ApiError, requireUser, route } from "@/lib/api";
import { prisma } from "@/lib/db";
import type { BatteryDetail } from "@/lib/detail-dto";
import { live } from "@/lib/live/store";
import { inScope } from "@/lib/rbac";
import { dayStart, DAY, simNow, wibDay } from "@/lib/sim/time";

export const GET = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  await live.init();
  const battery = await prisma.battery.findUnique({ where: { id } });
  if (!battery || !inScope(user, battery.gangId)) throw new ApiError(404, "Baterai tidak ditemukan.");

  const now = simNow(live.clock);
  const [recent, hourly, alerts, preds] = await Promise.all([
    prisma.batteryTelemetry.findMany({ where: { assetId: id, res: 5, ts: { gte: now - 2 * DAY, lte: now } }, orderBy: { ts: "asc" } }),
    prisma.batteryTelemetry.findMany({ where: { assetId: id, res: 60, ts: { gte: now - 31 * DAY, lte: now } }, orderBy: { ts: "asc" } }),
    listAlerts(user, { assetId: id, limit: 20 }),
    prisma.aiPrediction.findMany({ where: { assetId: id, kind: "anomaly" }, orderBy: { createdAt: "desc" } }),
  ]);

  const byDay = new Map<number, { soh: number[]; charge: number; discharge: number }>();
  for (const r of hourly) {
    const d = wibDay(r.ts);
    const row = byDay.get(d) ?? { soh: [], charge: 0, discharge: 0 };
    row.soh.push(r.soh);
    const kwh = (r.currentA * r.voltage) / 1000;
    if (kwh > 0) row.charge += kwh;
    else row.discharge -= kwh;
    byDay.set(d, row);
  }
  const days = [...byDay.entries()].sort((a, b) => a[0] - b[0]);
  const sohHistory = days.map(([d, v]) => ({ ts: dayStart(d), soh: median(v.soh) }));
  const siblings = [...live.batteries.values()].filter((b) => b.gangId === battery.gangId && b.id !== id).map((b) => b.tempC);

  const detail: BatteryDetail = {
    id,
    gangId: battery.gangId,
    chemistry: battery.chemistry,
    capacityKwh: battery.nominalCapacityKwh,
    nominalVoltage: battery.nominalVoltage,
    installDate: battery.installDate,
    lat: battery.lat,
    lng: battery.lng,
    simTs: now,
    series: recent.map((r) => ({ ts: r.ts, soc: r.soc, temp: r.tempC, voltage: r.voltage, current: r.currentA })),
    sohHistory,
    forecast: forecastSoh(sohHistory),
    energy: days.slice(-14).map(([d, v]) => ({ ts: dayStart(d), chargeKwh: v.charge, dischargeKwh: v.discharge })),
    peerTemp: median(siblings),
    health: live.health.get(id) ?? null,
    alerts,
    anomalies: preds.map((p) => ({ id: p.id, createdAt: p.createdAt, payload: JSON.parse(p.payloadJson) as AnomalyPayload })),
  };
  return NextResponse.json(detail);
});
