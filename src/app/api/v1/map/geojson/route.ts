import { NextResponse } from "next/server";
import { requireUser, route } from "@/lib/api";
import { prisma } from "@/lib/db";
import type { MapData } from "@/lib/map-dto";
import { canSeeOwnerName } from "@/lib/rbac";

/** Registry geometry for the map. Live status is merged on the client from the SSE snapshot. */
export const GET = route(async () => {
  const user = await requireUser();
  const [cluster, zones, solar, batteries, gateways] = await Promise.all([
    prisma.cluster.findFirst(),
    prisma.zone.findMany(),
    prisma.solarSystem.findMany({ include: { house: true } }),
    prisma.battery.findMany(),
    prisma.gateway.findMany(),
  ]);
  const data: MapData = {
    center: {
      lat: Number(process.env.NEXT_PUBLIC_MAP_CENTER_LAT ?? -6.2),
      lng: Number(process.env.NEXT_PUBLIC_MAP_CENTER_LNG ?? 106.8166),
      zoom: Number(process.env.NEXT_PUBLIC_MAP_ZOOM ?? 18),
    },
    boundary: cluster ? (JSON.parse(cluster.boundaryGeoJson) as [number, number][]) : [],
    zones: zones.map((g) => {
      const extra = JSON.parse(g.roadGeoJson) as { road: [number, number][]; label: [number, number] };
      return { id: g.id, name: g.name, boundary: JSON.parse(g.boundaryGeoJson) as [number, number][], road: extra.road, label: extra.label };
    }),
    houses: solar.map((s) => ({
      id: s.houseId,
      zoneId: s.house.zoneId,
      ownerCode: s.house.ownerCode,
      ownerName: canSeeOwnerName(user) ? s.house.ownerName : null,
      batteryId: s.house.batteryId,
      address: s.house.address,
      lat: s.lat,
      lng: s.lng,
      capacityKwp: s.capacityKwp,
      panelCount: s.panelCount,
      inverterModel: s.inverterModel,
      installDate: s.installDate,
    })),
    batteries: batteries.map((b) => ({ id: b.id, zoneId: b.zoneId, lat: b.lat, lng: b.lng, chemistry: b.chemistry, capacityKwh: b.nominalCapacityKwh, installDate: b.installDate })),
    gateways: gateways.map((g) => ({ id: g.id, zoneId: g.zoneId, lat: g.lat, lng: g.lng, firmware: g.firmware })),
  };
  return NextResponse.json(data);
});
