import { NextResponse } from "next/server";
import type { AnomalySeries } from "@/lib/ai/dto";
import { dailyRatios } from "@/lib/ai/features";
import type { AnomalyPayload } from "@/lib/ai/pipeline";
import { median } from "@/lib/ai/stats";
import { requireUser, route } from "@/lib/api";
import { prisma } from "@/lib/db";
import { live } from "@/lib/live/store";
import { dayStart, DAY, simNow } from "@/lib/sim/time";

/** The signal behind one anomaly, for the chart with its window highlighted. */
export const GET = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireUser();
  const { id } = await ctx.params;
  await live.init();
  const row = await prisma.aiPrediction.findUnique({ where: { id } });
  // A reset can delete the anomaly a chart is still polling. An empty series is the correct answer then.
  if (!row) return NextResponse.json({ kind: "none", label: "", unit: "", points: [], from: 0, to: 0 } satisfies AnomalySeries);
  const payload = JSON.parse(row.payloadJson) as AnomalyPayload;
  const now = simNow(live.clock);
  const none: AnomalySeries = { kind: "none", label: "", unit: "", points: [], from: payload.from, to: payload.to };

  if (row.assetType === "pv") {
    const from = now - 30 * DAY;
    const [wx, solar] = await Promise.all([
      prisma.weatherReading.findMany({ where: { res: 60, ts: { gte: from, lte: now } } }),
      prisma.solarSystem.findMany({ select: { houseId: true, capacityKwp: true, baselinePr: true } }),
    ]);
    const weather = new Map(wx.map((w) => [w.ts, { ts: w.ts, irradiance: w.irradiance, ambientC: w.ambientC }]));
    const rows = await prisma.solarTelemetry.findMany({ where: { assetId: { in: solar.map((s) => s.houseId) }, res: 60, ts: { gte: from, lte: now } }, select: { assetId: true, ts: true, acPowerW: true } });
    const peers = new Map<number, number[]>();
    let own: ReturnType<typeof dailyRatios> = [];
    for (const s of solar) {
      const series = rows.filter((r) => r.assetId === s.houseId).map((r) => ({ ts: r.ts, acW: r.acPowerW }));
      const ratios = dailyRatios(series, weather, s.capacityKwp, s.baselinePr);
      if (s.houseId === row.assetId) own = ratios;
      else for (const d of ratios) peers.set(d.day, [...(peers.get(d.day) ?? []), d.ratio]);
    }
    const points = own.map((d) => ({ ts: dayStart(d.day), value: d.ratio * 100, peer: median(peers.get(d.day) ?? [1]) * 100 }));
    // The ongoing day uses the live reading, so a fault shows on the chart as soon as it happens.
    const current = live.pv.get(row.assetId);
    const last = points[points.length - 1];
    if (payload.open && current && last) last.value = current.ratio * 100;
    const result: AnomalySeries = { kind: "ratio", label: "Aktual terhadap ekspektasi", unit: "%", points, from: dayStart(Math.floor((payload.from + 25200) / 86400)), to: dayStart(Math.floor((payload.to + 25200) / 86400)) };
    return NextResponse.json(result);
  }

  if (row.assetType === "battery") {
    const metric = payload.metric === "spreadMv" ? "spreadMv" : payload.metric === "soh" ? "soh" : "tempC";
    const from = Math.max(now - 30 * DAY, payload.from - 4 * DAY);
    const rows = await prisma.batteryTelemetry.findMany({ where: { assetId: row.assetId, res: 60, ts: { gte: from, lte: now } }, orderBy: { ts: "asc" }, select: { ts: true, tempC: true, spreadMv: true, soh: true } });
    const points = rows.map((r) => ({ ts: r.ts, value: r[metric] }));
    const b = live.batteries.get(row.assetId);
    if (b && payload.open) points.push({ ts: now, value: b[metric] });
    const meta = { tempC: ["Suhu maksimum", "°C"], spreadMv: ["Selisih tegangan sel", "mV"], soh: ["State of Health", "%"] }[metric];
    const result: AnomalySeries = { kind: metric, label: meta[0], unit: meta[1], points, from: payload.from, to: payload.open ? now : payload.to + DAY };
    return NextResponse.json(result);
  }
  return NextResponse.json(none);
});
