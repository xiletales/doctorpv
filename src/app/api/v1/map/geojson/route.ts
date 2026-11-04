import { NextResponse } from "next/server";
import { requireUser, route } from "@/lib/api";
import { prisma } from "@/lib/db";
import type { MapData } from "@/lib/map-dto";
import { canSeeOwnerName, gangScope } from "@/lib/rbac";

/** Registry geometry for the map. Live status is merged on the client from the SSE snapshot. */
export const GET = route(async () => {
  const user = await requireUser();
  const scope = gangScope(user);
  const gangFilter = scope ? { in: scope } : undefined;
  const [gangs, solar, batteries, gateways] = await Promise.all([
    prisma.gang.findMany({ where: { id: gangFilter } }),
    prisma.solarSystem.findMany({ where: { house: { gangId: gangFilter } }, include: { house: true } }),
    prisma.battery.findMany({ where: { gangId: gangFilter } }),
    prisma.gateway.findMany({ where: { gangId: gangFilter } }),
  ]);
  const data: MapData = {
    center: {
      lat: Number(process.env.NEXT_PUBLIC_MAP_CENTER_LAT ?? -6.9175),
      lng: Number(process.env.NEXT_PUBLIC_MAP_CENTER_LNG ?? 107.6191),
      zoom: Number(process.env.NEXT_PUBLIC_MAP_ZOOM ?? 16.6),
    },
    gangs: gangs.map((g) => {
      const extra = JSON.parse(g.alleyGeoJson) as { alley: [number, number][]; label: [number, number] };
      return { id: g.id, name: g.name, boundary: JSON.parse(g.boundaryGeoJson) as [number, number][], alley: extra.alley, label: extra.label };
    }),
    houses: solar.map((s) => ({
      id: s.houseId,
      gangId: s.house.gangId,
      ownerCode: s.house.ownerCode,
      ownerName: canSeeOwnerName(user, s.house.gangId) ? s.house.ownerName : null,
      address: s.house.address,
      lat: s.lat,
      lng: s.lng,
      capacityKwp: s.capacityKwp,
      panelCount: s.panelCount,
      inverterModel: s.inverterModel,
      installDate: s.installDate,
    })),
    batteries: batteries.map((b) => ({ id: b.id, gangId: b.gangId, lat: b.lat, lng: b.lng, chemistry: b.chemistry, capacityKwh: b.nominalCapacityKwh, installDate: b.installDate })),
    gateways: gateways.map((g) => ({ id: g.id, gangId: g.gangId, lat: g.lat, lng: g.lng, firmware: g.firmware })),
  };
  return NextResponse.json(data);
});
