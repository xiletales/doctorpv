import { NextResponse } from "next/server";
import { ApiError, requireResident, route } from "@/lib/api";
import { prisma } from "@/lib/db";
import { live } from "@/lib/live/store";
import type { ResidentDto } from "@/lib/resident-dto";
import { dayStart, simNow, wibDay } from "@/lib/sim/time";

/** A resident sees only their own house and battery status. Neighbor data never leaves the server. */
export const GET = route(async () => {
  const user = await requireResident();
  await live.init();
  const house = await prisma.house.findUnique({ where: { id: user.houseId }, include: { solar: true } });
  if (!house?.solar) throw new ApiError(404, "Data rumah tidak ditemukan.");
  const pv = live.pv.get(house.id);
  const battery = live.batteries.get(house.batteryId);
  if (!pv || !battery) throw new ApiError(404, "Data langsung belum tersedia.");
  const now = simNow(live.clock);
  const [rows, issues] = await Promise.all([
    prisma.solarTelemetry.findMany({ where: { assetId: house.id, res: 5, ts: { gte: dayStart(wibDay(now)), lte: now } }, orderBy: { ts: "asc" }, select: { ts: true, acPowerW: true } }),
    prisma.alert.findMany({ where: { assetId: house.id, status: { not: "resolved" } }, orderBy: { createdAt: "desc" } }),
  ]);
  const tariffRp = Number(process.env.PLN_TARIFF_RP ?? 1444.7);
  const dto: ResidentDto = {
    houseId: house.id,
    ownerName: house.ownerName,
    address: house.address,
    capacityKwp: house.solar.capacityKwp,
    simTs: now,
    acW: pv.acW,
    expectedW: pv.expectedW,
    todayKwh: pv.todayKwh,
    status: pv.status,
    savingsRp: pv.todayKwh * tariffRp,
    tariffRp,
    today: rows.map((r) => ({ ts: r.ts, w: r.acPowerW })),
    battery: { id: battery.id, soc: battery.soc, status: battery.status, charging: battery.currentA > 0.5, discharging: battery.currentA < -0.5 },
    issues: issues.map((a) => ({ id: a.id, message: a.message, recommendedAction: a.recommendedAction, createdAt: a.createdAt })),
  };
  return NextResponse.json(dto);
});
