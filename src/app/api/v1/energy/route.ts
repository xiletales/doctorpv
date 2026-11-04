import { NextResponse } from "next/server";
import { requireUser, route } from "@/lib/api";
import { prisma } from "@/lib/db";
import type { EnergyDto, EnergyPoint, EnergyTotals } from "@/lib/energy-dto";
import { clockTime, num } from "@/lib/format";
import { live } from "@/lib/live/store";
import { dayStart, DAY, simNow, wibDay } from "@/lib/sim/time";
import { ZONE_IDS } from "@/lib/sim/world";

const STEP_H = 300 / 3600;

interface Row { ts: number; pvW: number; loadW: number; plnImportW: number; chargeW: number; dischargeW: number; curtailW: number }

function totals(rows: Row[]): EnergyTotals {
  const sum = (f: (r: Row) => number) => (rows.reduce((a, r) => a + f(r), 0) * STEP_H) / 1000;
  return { pv: sum((r) => r.pvW), load: sum((r) => r.loadW), pln: sum((r) => r.plnImportW), charge: sum((r) => r.chargeW), discharge: sum((r) => r.dischargeW), curtail: sum((r) => r.curtailW) };
}

function curve(rows: Row[]): EnergyPoint[] {
  return rows.map((r) => ({ ts: r.ts, pvDirect: Math.max(0, r.pvW - r.chargeW - r.curtailW), discharge: r.dischargeW, pln: r.plnImportW }));
}

/** Rule-based advice from yesterday's full day, with each sentence built from measured values. */
function recommend(perZone: Map<string, Row[]>): string[] {
  const surplus: { weight: number; text: string }[] = [];
  const imports: { weight: number; text: string }[] = [];
  for (const [id, rows] of perZone) {
    const name = id.replace("Z", "Zona ");
    const firstCurtail = rows.find((r) => r.curtailW > 200);
    const t = totals(rows);
    if (firstCurtail && t.curtail > 1) {
      surplus.push({ weight: t.curtail, text: `Baterai ${name} penuh sekitar pukul ${clockTime(firstCurtail.ts)} kemarin dan ${num(t.curtail, 0)} kWh surya tidak terpakai. Geser beban fleksibel, seperti pompa air, ke tengah hari.` });
    }
    if (t.pln > 1) {
      const peak = rows.reduce((a, r) => (r.plnImportW > a.plnImportW ? r : a), rows[0]);
      imports.push({ weight: t.pln, text: `${name} mengimpor ${num(t.pln, 0)} kWh dari PLN kemarin, tertinggi sekitar pukul ${clockTime(peak.ts)}. Mengurangi beban pada jam itu paling menekan impor.` });
    }
  }
  // The two largest of each kind, so that one repeated sentence cannot fill the card.
  const top = (list: { weight: number; text: string }[]) => list.sort((a, b) => b.weight - a.weight).slice(0, 2).map((r) => r.text);
  return [...top(surplus), ...top(imports)];
}

/** Whole-cluster only: surplus moves between zones over the cluster bus, so the balance closes at this level. */
export const GET = route(async () => {
  await requireUser();
  await live.init();
  const scopeId = "CLUSTER";
  const now = simNow(live.clock);
  const today = dayStart(wibDay(now));
  const [rowsToday, rowsYesterday, zoneRows] = await Promise.all([
    prisma.energyMeterReading.findMany({ where: { scopeId, res: 5, ts: { gte: today, lte: now } }, orderBy: { ts: "asc" } }),
    prisma.energyMeterReading.findMany({ where: { scopeId, res: 5, ts: { gte: today - DAY, lt: today } }, orderBy: { ts: "asc" } }),
    prisma.energyMeterReading.findMany({ where: { scopeId: { in: [...ZONE_IDS] }, res: 5, ts: { gte: today - DAY, lt: today } }, orderBy: { ts: "asc" } }),
  ]);
  const perZone = new Map<string, Row[]>();
  for (const r of zoneRows) perZone.set(r.scopeId, [...(perZone.get(r.scopeId) ?? []), r]);

  const dto: EnergyDto = {
    scopeLabel: "Seluruh klaster",
    simTs: now,
    dayStart: today,
    today: { totals: totals(rowsToday), curve: curve(rowsToday) },
    yesterday: { totals: totals(rowsYesterday), curve: curve(rowsYesterday) },
    recommendations: recommend(perZone),
    tariffRp: Number(process.env.PLN_TARIFF_RP ?? 1444.7),
    emissionFactor: Number(process.env.GRID_EMISSION_FACTOR ?? 0.87),
  };
  return NextResponse.json(dto);
});
