import { NextResponse } from "next/server";
import { expectedPowerW } from "@/lib/ai/expected";
import { dailyRatios } from "@/lib/ai/features";
import type { AnomalyPayload } from "@/lib/ai/pipeline";
import { listAlerts } from "@/lib/alerts/query";
import { ApiError, requireUser, route } from "@/lib/api";
import { prisma } from "@/lib/db";
import type { HouseDetail } from "@/lib/detail-dto";
import { live } from "@/lib/live/store";
import { canSeeOwnerName, inScope } from "@/lib/rbac";
import { dayStart, DAY, simNow, wibDay } from "@/lib/sim/time";

export const GET = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  await live.init();
  const solar = await prisma.solarSystem.findUnique({ where: { houseId: id }, include: { house: true } });
  if (!solar || !inScope(user, solar.house.gangId)) throw new ApiError(404, "Rumah tidak ditemukan.");

  const now = simNow(live.clock);
  const today = dayStart(wibDay(now));
  const [todayRows, wx5, hourly, wx60, alerts, preds] = await Promise.all([
    prisma.solarTelemetry.findMany({ where: { assetId: id, res: 5, ts: { gte: today, lte: now } }, orderBy: { ts: "asc" } }),
    prisma.weatherReading.findMany({ where: { res: 5, ts: { gte: today, lte: now } }, orderBy: { ts: "asc" } }),
    prisma.solarTelemetry.findMany({ where: { assetId: id, res: 60, ts: { gte: now - 30 * DAY, lte: now } }, orderBy: { ts: "asc" }, select: { ts: true, acPowerW: true } }),
    prisma.weatherReading.findMany({ where: { res: 60, ts: { gte: now - 30 * DAY, lte: now } } }),
    listAlerts(user, { assetId: id, limit: 20 }),
    prisma.aiPrediction.findMany({ where: { assetId: id, kind: "anomaly" }, orderBy: { createdAt: "desc" } }),
  ]);

  const actualAt = new Map(todayRows.map((r) => [r.ts, r.acPowerW]));
  const weather = new Map(wx60.map((w) => [w.ts, { ts: w.ts, irradiance: w.irradiance, ambientC: w.ambientC }]));
  const daily = dailyRatios(hourly.map((r) => ({ ts: r.ts, acW: r.acPowerW })), weather, solar.capacityKwp, solar.baselinePr);

  const detail: HouseDetail = {
    id,
    gangId: solar.house.gangId,
    ownerCode: solar.house.ownerCode,
    ownerName: canSeeOwnerName(user, solar.house.gangId) ? solar.house.ownerName : null,
    address: solar.house.address,
    lat: solar.lat,
    lng: solar.lng,
    capacityKwp: solar.capacityKwp,
    panelCount: solar.panelCount,
    inverterModel: solar.inverterModel,
    tilt: solar.tilt,
    azimuth: solar.azimuth,
    installDate: solar.installDate,
    baselinePr: solar.baselinePr,
    simTs: now,
    dayStart: today,
    today: wx5.map((w) => ({
      ts: w.ts,
      actual: actualAt.get(w.ts) ?? 0,
      expected: expectedPowerW(solar.capacityKwp, w.irradiance, w.ambientC, solar.baselinePr),
    })),
    daily: daily.map((d) => ({ ts: dayStart(d.day), kwh: d.actualWh / 1000, expectedKwh: d.expectedWh / 1000, ratio: d.ratio })),
    health: live.health.get(id) ?? null,
    alerts,
    anomalies: preds.map((p) => ({ id: p.id, createdAt: p.createdAt, payload: JSON.parse(p.payloadJson) as AnomalyPayload })),
  };
  return NextResponse.json(detail);
});
