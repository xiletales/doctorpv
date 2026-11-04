import { expectedPowerW } from "./ai/expected";
import { prisma } from "./db";
import { live } from "./live/store";
import { gangScope } from "./rbac";
import { ambientC, clearSky } from "./sim/physics";
import { dayStart, DAY, simNow, wibDay } from "./sim/time";
import type { SessionUser } from "./types";

export interface CurvePoint {
  ts: number;
  pv: number;
  load: number;
  pln: number;
  charge: number;
  discharge: number;
  curtail: number;
}

export interface OverviewDto {
  scopeLabel: string;
  simTs: number;
  dayStart: number;
  kpi: {
    houses: number;
    gangs: number;
    activePv: number;
    batteries: number;
    pvKwh: number;
    pvKwhYesterday: number;
    loadKwh: number;
    loadKwhYesterday: number;
    plnKwh: number;
    selfSufficiency: number;
    selfSufficiencyYesterday: number;
    avgSoh: number;
    activeFaults: number;
    openWorkOrders: number;
    savingsRp: number;
    avoidedKg: number;
  };
  today: CurvePoint[];
  yesterday: { ts: number; pv: number; load: number }[];
  expected: { ts: number; w: number }[];
  trend: { ts: number; pr: number; soc: number; soh: number }[];
  faultsByGang: { gangId: string; critical: number; high: number; medium: number; low: number }[];
}

const kwh = (sumW: number) => (sumW * 300) / 3600 / 1000;

/** Everything in this response is limited to the user's gangs. Coordinators never get RT totals. */
export async function buildOverview(user: SessionUser, gangParam: string | null): Promise<OverviewDto> {
  await live.init();
  const scope = gangScope(user);
  const allowed = scope ?? ["G1", "G2", "G3", "G4", "G5"];
  const gang = gangParam && allowed.includes(gangParam) ? gangParam : null;
  const gangs = gang ? [gang] : allowed;
  const scopeId = gang ?? (scope === null ? "RT" : allowed[0]);

  const now = simNow(live.clock);
  const today = dayStart(wibDay(now));
  const yesterdayStart = today - DAY;

  const [rowsToday, rowsYesterday] = await Promise.all([
    prisma.energyMeterReading.findMany({ where: { scopeId, res: 5, ts: { gte: today, lte: now } }, orderBy: { ts: "asc" } }),
    prisma.energyMeterReading.findMany({ where: { scopeId, res: 5, ts: { gte: yesterdayStart, lt: today } }, orderBy: { ts: "asc" } }),
  ]);

  const solar = await prisma.solarSystem.findMany({
    where: { house: { gangId: { in: gangs } } },
    select: { capacityKwp: true, baselinePr: true, house: { select: { id: true } } },
  });
  const expected: { ts: number; w: number }[] = [];
  for (let t = today; t < today + DAY; t += 900) {
    const g = clearSky(t);
    let w = 0;
    for (const s of solar) w += expectedPowerW(s.capacityKwp, g, ambientC(t), s.baselinePr);
    expected.push({ ts: t, w });
  }

  const sameTimeY = rowsYesterday.filter((r) => r.ts <= now - DAY);
  const pvKwh = kwh(rowsToday.reduce((a, r) => a + r.pvW, 0));
  const loadKwh = kwh(rowsToday.reduce((a, r) => a + r.loadW, 0));
  const plnKwh = kwh(rowsToday.reduce((a, r) => a + r.plnImportW, 0));
  const pvY = kwh(sameTimeY.reduce((a, r) => a + r.pvW, 0));
  const loadY = kwh(sameTimeY.reduce((a, r) => a + r.loadW, 0));
  const plnY = kwh(sameTimeY.reduce((a, r) => a + r.plnImportW, 0));

  const start30 = today - 29 * DAY;
  const placeholders = gangs.map((g) => `'${g}'`).join(",");
  const battDaily = await prisma.$queryRawUnsafe<{ d: number; soc: number; soh: number }[]>(
    `SELECT (t.ts + 25200) / 86400 AS d, AVG(t.soc) AS soc, AVG(t.soh) AS soh
     FROM BatteryTelemetry t JOIN Battery b ON b.id = t.assetId
     WHERE t.res = 60 AND t.ts >= ${start30} AND t.ts <= ${now} AND b.gangId IN (${placeholders}) GROUP BY d ORDER BY d`,
  );
  const [meter30, weather30] = await Promise.all([
    prisma.energyMeterReading.findMany({ where: { scopeId, res: 60, ts: { gte: start30, lte: now } }, select: { ts: true, pvW: true } }),
    prisma.weatherReading.findMany({ where: { res: 60, ts: { gte: start30, lte: now } } }),
  ]);
  const wMap = new Map(weather30.map((w) => [w.ts, w.irradiance]));
  const totalKwp = solar.reduce((a, s) => a + s.capacityKwp, 0);
  const prDays = new Map<number, { e: number; ref: number }>();
  for (const m of meter30) {
    const g = wMap.get(m.ts) ?? 0;
    if (g < 100) continue;
    const d = wibDay(m.ts);
    const row = prDays.get(d) ?? { e: 0, ref: 0 };
    row.e += m.pvW;
    row.ref += totalKwp * g;
    prDays.set(d, row);
  }
  const trend = battDaily.map((b) => {
    const pr = prDays.get(Number(b.d));
    return { ts: dayStart(Number(b.d)), soc: Number(b.soc), soh: Number(b.soh), pr: pr && pr.ref > 0 ? pr.e / pr.ref : 0 };
  });

  const open = await prisma.alert.findMany({ where: { status: { not: "resolved" }, gangId: { in: allowed } }, select: { gangId: true, priority: true, assetType: true, type: true } });
  const faultsByGang = allowed.map((g) => {
    const list = open.filter((a) => a.gangId === g);
    const n = (p: string) => list.filter((a) => a.priority === p).length;
    return { gangId: g, critical: n("critical"), high: n("high"), medium: n("medium"), low: n("low") };
  });

  const pvLive = [...live.pv.values()].filter((p) => gangs.includes(p.gangId));
  const battLive = [...live.batteries.values()].filter((b) => gangs.includes(b.gangId));
  const wo = await prisma.workOrder.count({ where: { gangId: { in: gangs }, status: { not: "done" } } });
  const tariff = Number(process.env.PLN_TARIFF_RP ?? 1444.7);
  const emission = Number(process.env.GRID_EMISSION_FACTOR ?? 0.87);
  const avoidedGrid = Math.max(0, loadKwh - plnKwh);

  return {
    scopeLabel: gang ? gang.replace("G", "Gang ") : scope === null ? "Seluruh RT" : allowed.map((g) => g.replace("G", "Gang ")).join(", "),
    simTs: now,
    dayStart: today,
    kpi: {
      houses: pvLive.length,
      gangs: gangs.length,
      activePv: pvLive.filter((p) => p.status !== "offline" && p.inverter !== "TRIP").length,
      batteries: battLive.length,
      pvKwh,
      pvKwhYesterday: pvY,
      loadKwh,
      loadKwhYesterday: loadY,
      plnKwh,
      selfSufficiency: loadKwh > 0 ? 1 - plnKwh / loadKwh : 0,
      selfSufficiencyYesterday: loadY > 0 ? 1 - plnY / loadY : 0,
      avgSoh: battLive.reduce((a, b) => a + b.soh, 0) / Math.max(battLive.length, 1),
      activeFaults: open.filter((a) => gangs.includes(a.gangId) && a.priority !== "low").length,
      openWorkOrders: wo,
      savingsRp: avoidedGrid * tariff,
      avoidedKg: avoidedGrid * emission,
    },
    today: rowsToday.map((r) => ({ ts: r.ts, pv: r.pvW, load: r.loadW, pln: r.plnImportW, charge: r.chargeW, discharge: r.dischargeW, curtail: r.curtailW })),
    yesterday: rowsYesterday.map((r) => ({ ts: r.ts + DAY, pv: r.pvW, load: r.loadW })),
    expected,
    trend,
    faultsByGang,
  };
}
