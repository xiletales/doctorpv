import { NextResponse } from "next/server";
import { requireUser, route } from "@/lib/api";
import { prisma } from "@/lib/db";
import { live } from "@/lib/live/store";
import { dayStart, DAY, simNow, wibDay } from "@/lib/sim/time";
import type { TimelineDto } from "@/lib/timeline-dto";

/** Today in 5-minute steps for Time Travel. Rows after "now" come from the model and are labeled as a forecast. */
export const GET = route(async () => {
  await requireUser();
  await live.init();
  const now = simNow(live.clock);
  const today = dayStart(wibDay(now));
  const range = { gte: today, lt: today + DAY };
  const [meter, weather, soc] = await Promise.all([
    prisma.energyMeterReading.findMany({ where: { scopeId: "CLUSTER", res: 5, ts: range }, orderBy: { ts: "asc" } }),
    prisma.weatherReading.findMany({ where: { res: 5, ts: range } }),
    prisma.batteryTelemetry.groupBy({ by: ["ts"], where: { res: 5, ts: range }, _avg: { soc: true } }),
  ]);
  const irradiance = new Map(weather.map((w) => [w.ts, w.irradiance]));
  const socAt = new Map(soc.map((s) => [s.ts, s._avg.soc ?? 0]));
  const dto: TimelineDto = {
    now,
    dayStart: today,
    points: meter.map((m) => ({
      ts: m.ts, pvW: m.pvW, loadW: m.loadW, plnW: m.plnImportW, chargeW: m.chargeW, dischargeW: m.dischargeW, curtailW: m.curtailW,
      irradiance: irradiance.get(m.ts) ?? 0, soc: socAt.get(m.ts) ?? 0,
    })),
  };
  return NextResponse.json(dto);
});
