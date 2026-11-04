import { seeded } from "./rng";

export interface LatLng {
  lat: number;
  lng: number;
}

export interface HouseDef extends LatLng {
  id: string;
  index: number;
  gangId: string;
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
  gangId: string;
  capacityKwh: number;
  nominalV: number;
  ageDays: number;
  sohRef: number;
  sohRatePerDay: number;
  socOffset: number;
  tempOffset: number;
}

export interface GatewayDef extends LatLng {
  id: string;
  gangId: string;
  firmware: string;
}

export interface GangDef {
  id: string;
  name: string;
  code: string;
  boundary: [number, number][];
  alley: [number, number][];
  labelLat: number;
  labelLng: number;
}

export interface World {
  gangs: GangDef[];
  houses: HouseDef[];
  batteries: BatteryDef[];
  gateways: GatewayDef[];
}

const FIRST = ["Sri", "Bambang", "Wati", "Joko", "Siti", "Hendra", "Rina", "Yusuf", "Lina", "Dedi", "Nur", "Eko", "Maya", "Rudi", "Tuti", "Asep", "Ani", "Iwan", "Yanti", "Fajar"];
const LAST = ["Rahayu", "Saputra", "Wulandari", "Pratama", "Kusuma", "Hidayat", "Permata", "Nugroho", "Sari", "Setiawan", "Utami", "Gunawan", "Maharani", "Firmansyah", "Andini"];
const INVERTERS = ["SuryaGrid SG-2K", "SuryaGrid SG-3K", "HelioVolt HV-2.5K", "HelioVolt HV-3K"];
const CAPACITIES = [1.1, 1.1, 1.65, 1.65, 2.2, 2.2, 2.75, 3.3];

const ALLEY_LEN = 250;
const ALLEY_GAP = 62;
const ROTATION = (14 * Math.PI) / 180;

/** Battery health at the reference day. Only B043 sits under the 80% end-of-life threshold by default. */
const SOH_OVERRIDE: Record<string, { soh: number; rate: number }> = {
  B043: { soh: 78.4, rate: 0.055 },
  B028: { soh: 85.2, rate: 0.045 },
};

export function buildWorld(center: LatLng): World {
  const rand = seeded(20261107);
  const mLat = 1 / 111320;
  const mLng = 1 / (111320 * Math.cos((center.lat * Math.PI) / 180));
  /** Local metres (x along alley, y across alleys) to lat/lng, with a slight street-grid rotation. */
  const geo = (x: number, y: number): LatLng => {
    const rx = x * Math.cos(ROTATION) - y * Math.sin(ROTATION);
    const ry = x * Math.sin(ROTATION) + y * Math.cos(ROTATION);
    return { lat: center.lat + ry * mLat, lng: center.lng + rx * mLng };
  };
  const pair = (x: number, y: number): [number, number] => {
    const p = geo(x, y);
    return [p.lng, p.lat];
  };

  const world: World = { gangs: [], houses: [], batteries: [], gateways: [] };
  let houseIdx = 0;
  let battIdx = 0;

  for (let g = 0; g < 5; g++) {
    const gangId = `G${g + 1}`;
    const y = (2 - g) * ALLEY_GAP;
    const half = ALLEY_GAP / 2 - 1.5;
    const hx = ALLEY_LEN / 2 + 8;
    const label = geo(-hx - 12, y);
    world.gangs.push({
      id: gangId,
      name: `Gang ${g + 1}`,
      code: `GANG-${g + 1}`,
      boundary: [pair(-hx, y - half), pair(hx, y - half), pair(hx, y + half), pair(-hx, y + half), pair(-hx, y - half)],
      alley: [pair(-hx, y), pair(hx, y)],
      labelLat: label.lat,
      labelLng: label.lng,
    });

    for (let n = 0; n < 20; n++) {
      const side = n % 2 === 0 ? 1 : -1;
      const col = Math.floor(n / 2);
      const x = -ALLEY_LEN / 2 + 12 + col * ((ALLEY_LEN - 24) / 9) + (rand() - 0.5) * 3;
      const off = side * (15 + (rand() - 0.5) * 3);
      const pos = geo(x, y + off);
      const pv = geo(x + 1.8, y + off + side * 2.2);
      houseIdx += 1;
      const id = `H${String(houseIdx).padStart(3, "0")}`;
      const cap = CAPACITIES[Math.floor(rand() * CAPACITIES.length)];
      world.houses.push({
        id,
        index: houseIdx,
        gangId,
        ownerCode: `PLG-${String(houseIdx * 37 + 1000)}`,
        ownerName: `${FIRST[Math.floor(rand() * FIRST.length)]} ${LAST[Math.floor(rand() * LAST.length)]}`,
        address: `Gang ${g + 1} No. ${n + 1}`,
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
        registryStatus: id === "H093" ? "maintenance" : "active",
      });
    }

    for (let n = 0; n < 10; n++) {
      battIdx += 1;
      const id = `B${String(battIdx).padStart(3, "0")}`;
      const x = -ALLEY_LEN / 2 + 22 + n * ((ALLEY_LEN - 44) / 9);
      const pos = geo(x, y + (n % 2 === 0 ? 5 : -5));
      const ageDays = 360 + Math.floor(rand() * 900);
      const override = SOH_OVERRIDE[id];
      const rate = 0.012 + rand() * 0.018;
      const aged = 100 - ageDays * rate - rand() * 3;
      const healthy = aged < 83 ? 83 + rand() * 6 : aged;
      world.batteries.push({
        id,
        index: battIdx,
        gangId,
        lat: pos.lat,
        lng: pos.lng,
        capacityKwh: 10.24,
        nominalV: 51.2,
        ageDays,
        sohRef: override?.soh ?? healthy,
        sohRatePerDay: override?.rate ?? rate,
        socOffset: (rand() - 0.5) * 8,
        tempOffset: (rand() - 0.5) * 3,
      });
    }

    const gw = geo(hx - 4, y + 4);
    world.gateways.push({ id: `GW-${g + 1}`, gangId, firmware: `2.${3 + (g % 2)}.1`, lat: gw.lat, lng: gw.lng });
  }
  return world;
}

export function envCenter(): LatLng {
  return {
    lat: Number(process.env.NEXT_PUBLIC_MAP_CENTER_LAT ?? -6.9175),
    lng: Number(process.env.NEXT_PUBLIC_MAP_CENTER_LNG ?? 107.6191),
  };
}
