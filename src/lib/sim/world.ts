import { COVERAGE, FACILITIES, SITE, type FacilityKind } from "../site";
import { seeded } from "./rng";

export interface LatLng {
  lat: number;
  lng: number;
}

export interface HouseDef extends LatLng {
  id: string;
  index: number;
  zoneId: string;
  gatewayId: string;
  batteryId: string;
  /** A home, or one of the public buildings counted among the 30 points. */
  kind: "rumah" | FacilityKind;
  ownerCode: string;
  ownerName: string;
  address: string;
  capacityKwp: number;
  panelCount: number;
  inverterModel: string;
  tilt: number;
  azimuth: number;
  ageDays: number;
  pr: number;
  loadScale: number;
  pvLat: number;
  pvLng: number;
  registryStatus: "active" | "maintenance";
}

export interface BatteryDef extends LatLng {
  id: string;
  index: number;
  zoneId: string;
  gatewayId: string;
  houseIds: [string, string];
  capacityKwh: number;
  nominalV: number;
  ageDays: number;
  sohRef: number;
  sohRatePerDay: number;
  tempOffset: number;
}

export interface GatewayDef extends LatLng {
  id: string;
  zoneId: string;
  firmware: string;
}

export interface ZoneDef {
  id: string;
  name: string;
  code: string;
  boundary: [number, number][];
  road: [number, number][];
  labelLat: number;
  labelLng: number;
}

export interface World {
  boundary: [number, number][];
  zones: ZoneDef[];
  houses: HouseDef[];
  batteries: BatteryDef[];
  gateways: GatewayDef[];
}

export const ZONE_IDS = ["ZA", "ZB", "ZC"] as const;

const FIRST = ["Sri", "Bambang", "Wati", "Joko", "Siti", "Hendra", "Rina", "Yusuf", "Lina", "Dedi", "Nur", "Eko", "Maya", "Rudi", "Tuti", "Asep", "Ani", "Iwan", "Yanti", "Fajar"];
const LAST = ["Rahayu", "Saputra", "Wulandari", "Pratama", "Kusuma", "Hidayat", "Permata", "Nugroho", "Sari", "Setiawan", "Utami", "Gunawan", "Maharani", "Firmansyah", "Andini"];
const INVERTERS = ["SuryaGrid SG-2K", "SuryaGrid SG-3K", "HelioVolt HV-2.5K", "HelioVolt HV-3K"];
const CAPACITIES = [1.1, 1.1, 1.65, 1.65, 2.2, 2.2, 2.75, 3.3];

const COLUMN = 26;
const ROAD_GAP = 58;
const ROTATION = (14 * Math.PI) / 180;

/** B12 starts just above end of life, so that the fast-forward scenario crosses the threshold. */
const SOH_OVERRIDE: Record<string, { soh: number; rate: number }> = {
  B12: { soh: 81.5, rate: 0.07 },
};

const id2 = (prefix: string, n: number) => `${prefix}${String(n).padStart(2, "0")}`;

/** 3 zones, each with one internal road, 5 house pairs across it, and a battery at each pair. */
export function buildWorld(center: LatLng): World {
  const rand = seeded(20261107);
  const mLat = 1 / 111320;
  const mLng = 1 / (111320 * Math.cos((center.lat * Math.PI) / 180));
  const geo = (x: number, y: number): LatLng => {
    const rx = x * Math.cos(ROTATION) - y * Math.sin(ROTATION);
    const ry = x * Math.sin(ROTATION) + y * Math.cos(ROTATION);
    return { lat: center.lat + ry * mLat, lng: center.lng + rx * mLng };
  };
  const pair = (x: number, y: number): [number, number] => {
    const p = geo(x, y);
    return [p.lng, p.lat];
  };

  const hx = (COLUMN * 5) / 2 + 6;
  const halfAll = ROAD_GAP * 1.5 - 1;
  const world: World = {
    boundary: [pair(-hx - 4, -halfAll - 3), pair(hx + 4, -halfAll - 3), pair(hx + 4, halfAll + 3), pair(-hx - 4, halfAll + 3), pair(-hx - 4, -halfAll - 3)],
    zones: [],
    houses: [],
    batteries: [],
    gateways: [],
  };
  let houseIdx = 0;
  let battIdx = 0;

  ZONE_IDS.forEach((zoneId, z) => {
    const gatewayId = `GW-${z + 1}`;
    const y = (1 - z) * ROAD_GAP;
    const half = ROAD_GAP / 2 - 1.5;
    const label = geo(-hx - 16, y);
    world.zones.push({
      id: zoneId,
      name: COVERAGE[zoneId].label,
      code: `ZONE-${zoneId.slice(1)}`,
      boundary: [pair(-hx, y - half), pair(hx, y - half), pair(hx, y + half), pair(-hx, y + half), pair(-hx, y - half)],
      road: [pair(-hx, y), pair(hx, y)],
      labelLat: label.lat,
      labelLng: label.lng,
    });

    for (let col = 0; col < 5; col++) {
      battIdx += 1;
      const batteryId = id2("B", battIdx);
      const x = -((COLUMN * 4) / 2) + col * COLUMN;
      const memberIds: string[] = [];
      for (const side of [1, -1]) {
        houseIdx += 1;
        const id = id2("H", houseIdx);
        memberIds.push(id);
        const hxPos = x + (rand() - 0.5) * 3;
        const off = side * (15 + (rand() - 0.5) * 3);
        const ownerName = `${FIRST[Math.floor(rand() * FIRST.length)]} ${LAST[Math.floor(rand() * LAST.length)]}`;
        const pos = geo(hxPos, y + off);
        const pv = geo(hxPos + 1.8, y + off + side * 2.2);
        const facility = FACILITIES[id];
        const drawn = CAPACITIES[Math.floor(rand() * CAPACITIES.length)];
        const cap = facility ? 3.3 : drawn;
        world.houses.push({
          id,
          index: houseIdx,
          zoneId,
          gatewayId,
          batteryId,
          kind: facility?.kind ?? "rumah",
          ownerCode: `PLG-${houseIdx * 37 + 1000}`,
          ownerName: facility ? "Fasilitas umum RW 1" : ownerName,
          address: facility ? `${facility.name}, ${COVERAGE[zoneId].label}` : `${COVERAGE[zoneId].label} No. ${houseIdx - z * 10}`,
          lat: pos.lat,
          lng: pos.lng,
          pvLat: pv.lat,
          pvLng: pv.lng,
          capacityKwp: cap,
          panelCount: Math.round(cap / 0.55),
          inverterModel: INVERTERS[cap > 2.2 ? (rand() > 0.5 ? 1 : 3) : rand() > 0.5 ? 0 : 2],
          tilt: 10 + Math.floor(rand() * 11),
          azimuth: rand() > 0.5 ? 0 : 180,
          ageDays: 420 + Math.floor(rand() * 720),
          pr: 0.75 + rand() * 0.07,
          loadScale: 0.8 + rand() * 0.45,
          registryStatus: id === "H19" ? "maintenance" : "active",
        });
      }
      const pos = geo(x + 6, y + (col % 2 === 0 ? 4.5 : -4.5));
      const ageDays = 360 + Math.floor(rand() * 900);
      const override = SOH_OVERRIDE[batteryId];
      const rate = 0.012 + rand() * 0.018;
      const aged = 100 - ageDays * rate - rand() * 3;
      world.batteries.push({
        id: batteryId,
        index: battIdx,
        zoneId,
        gatewayId,
        houseIds: [memberIds[0], memberIds[1]],
        lat: pos.lat,
        lng: pos.lng,
        capacityKwh: 10.24,
        nominalV: 51.2,
        ageDays,
        sohRef: override?.soh ?? (aged < 83 ? 83 + rand() * 6 : aged),
        sohRatePerDay: override?.rate ?? rate,
        tempOffset: (rand() - 0.5) * 3,
      });
    }
    const gw = geo(-9, y + 4.5);
    world.gateways.push({ id: gatewayId, zoneId, firmware: `2.${3 + (z % 2)}.1`, lat: gw.lat, lng: gw.lng });
  });
  return world;
}

export function envCenter(): LatLng {
  return {
    lat: Number(process.env.NEXT_PUBLIC_MAP_CENTER_LAT ?? SITE.center.lat),
    lng: Number(process.env.NEXT_PUBLIC_MAP_CENTER_LNG ?? SITE.center.lng),
  };
}
