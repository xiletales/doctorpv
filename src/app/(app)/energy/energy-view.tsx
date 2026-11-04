"use client";
import { useQuery } from "@tanstack/react-query";
import { Lightbulb } from "lucide-react";
import { useMemo, useState } from "react";
import { axisTooltip, EChart, FONT, grid, legend, timeAxis, tooltip, useChartTheme, valueAxis, type ChartTheme } from "@/components/charts/echart";
import { GangFilter, StatTile } from "@/components/domain/asset-parts";
import { EnergyFlow, type FlowValues } from "@/components/domain/energy-flow";
import { DisclaimerNote, ErrorState, PageTitle } from "@/components/domain/status";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, Skeleton } from "@/components/ui/card";
import { apiGet } from "@/lib/client";
import type { EnergyDto, EnergyPoint, EnergyTotals } from "@/lib/energy-dto";
import { num, rupiah } from "@/lib/format";
import { useLive } from "@/stores/live";
import { useUi } from "@/stores/ui";

function sankeyOption(tot: EnergyTotals, t: ChartTheme) {
  const pvDirect = Math.max(0, tot.pv - tot.charge - tot.curtail);
  const stored = tot.charge - tot.discharge;
  const color: Record<string, string> = { PV: t.pv, Baterai: t.battery, PLN: t.pln, "Beban rumah": t.load, "Tidak terpakai": t.faint, "Tersimpan dan rugi": t.muted, "Simpanan sebelumnya": t.muted };
  const links = [
    { source: "PV", target: "Beban rumah", value: pvDirect },
    { source: "PV", target: "Baterai", value: tot.charge },
    { source: "PV", target: "Tidak terpakai", value: tot.curtail },
    { source: "Baterai", target: "Beban rumah", value: tot.discharge },
    { source: "PLN", target: "Beban rumah", value: tot.pln },
    ...(stored > 0.5 ? [{ source: "Baterai", target: "Tersimpan dan rugi", value: stored }] : []),
    ...(stored < -0.5 ? [{ source: "Simpanan sebelumnya", target: "Baterai", value: -stored }] : []),
  ].filter((l) => l.value > 0.05);
  const names = [...new Set(links.flatMap((l) => [l.source, l.target]))];
  return {
    animation: false,
    tooltip: {
      backgroundColor: t.surface,
      borderColor: t.grid,
      textStyle: { color: t.textStrong, fontSize: 12, fontFamily: FONT },
      formatter: (p: { dataType: string; name: string; value: number; data: { source?: string; target?: string } }) =>
        p.dataType === "edge" ? `${p.data.source} ke ${p.data.target}<br/><b>${num(p.value, 1)} kWh</b>` : `${p.name}<br/><b>${num(p.value, 1)} kWh</b>`,
    },
    series: [{
      type: "sankey",
      left: 8, right: 130, top: 8, bottom: 8,
      nodeWidth: 14,
      nodeGap: 14,
      draggable: false,
      emphasis: { focus: "adjacency" },
      data: names.map((name) => ({ name, itemStyle: { color: color[name], borderWidth: 0 } })),
      links,
      lineStyle: { color: "gradient", opacity: t.dark ? 0.32 : 0.26, curveness: 0.5 },
      label: {
        color: t.textStrong,
        fontSize: 12,
        fontFamily: FONT,
        formatter: (p: { name: string; value: number }) => `${p.name}  ${num(p.value, 0)} kWh`,
      },
    }],
  };
}

function SourceChart({ curve, dayStart }: { curve: EnergyPoint[]; dayStart: number }) {
  const t = useChartTheme();
  const option = useMemo(() => {
    const area = (name: string, color: string, pick: (p: EnergyPoint) => number) => ({
      name, type: "line", stack: "s", showSymbol: false, data: curve.map((p) => [p.ts * 1000, pick(p) / 1000]),
      lineStyle: { width: 0 }, itemStyle: { color }, areaStyle: { color, opacity: 0.9 },
    });
    return {
      animation: false,
      tooltip: { ...tooltip(t), formatter: axisTooltip("kW") },
      legend: legend(t),
      grid: grid(),
      xAxis: timeAxis(t, "clock", { min: dayStart * 1000, max: (dayStart + 86400) * 1000 }),
      yAxis: valueAxis(t, "kW"),
      series: [area("PV langsung", t.pv, (p) => p.pvDirect), area("Baterai", t.battery, (p) => p.discharge), area("PLN", t.pln, (p) => p.pln)],
    };
  }, [curve, dayStart, t]);
  return <EChart option={option} style={{ height: 280 }} ariaLabel="Kontribusi sumber energi untuk beban sepanjang hari" />;
}

export function EnergyView() {
  const gangId = useUi((s) => s.gangId);
  const snapshot = useLive((s) => s.snapshot);
  const [day, setDay] = useState<"today" | "yesterday">("yesterday");
  const t = useChartTheme();
  const q = useQuery({
    queryKey: ["energy", gangId],
    queryFn: () => apiGet<EnergyDto>(`/api/v1/energy${gangId ? `?gangId=${gangId}` : ""}`),
    refetchInterval: 60_000,
  });
  const flow = useMemo<FlowValues | null>(() => {
    if (!snapshot) return null;
    const list = gangId ? snapshot.gangs.filter((g) => g.id === gangId) : snapshot.gangs;
    const sum = (f: (g: (typeof list)[number]) => number) => list.reduce((a, g) => a + f(g), 0);
    return { pvW: sum((g) => g.pvW), loadW: sum((g) => g.loadW), plnW: sum((g) => g.plnW), chargeW: sum((g) => g.chargeW), dischargeW: sum((g) => g.dischargeW), curtailW: sum((g) => g.curtailW), soc: sum((g) => g.avgSoc) / Math.max(list.length, 1) };
  }, [snapshot, gangId]);
  const d = q.data;
  const selected = d ? (day === "today" ? d.today : d.yesterday) : null;
  const tot = selected?.totals;
  const sankey = useMemo(() => (tot ? sankeyOption(tot, t) : null), [tot, t]);

  if (q.isError) return <div className="p-6"><Card><ErrorState message={(q.error as Error).message} /></Card></div>;

  const balance = tot ? tot.pv + tot.pln + tot.discharge - (tot.load + tot.charge + tot.curtail) : 0;
  const selfConsumption = tot && tot.pv > 0 ? (tot.pv - tot.curtail) / tot.pv : 0;
  const selfSufficiency = tot && tot.load > 0 ? 1 - tot.pln / tot.load : 0;
  const avoided = tot ? Math.max(0, tot.load - tot.pln) : 0;

  return (
    <div className="space-y-4 p-4 md:p-6">
      <PageTitle title="Energi hibrida" description="Aliran energi antara PV, baterai bersama, PLN, dan beban rumah." action={<GangFilter />} />

      <section className="grid items-center gap-4 rounded-2xl bg-rail p-5 text-white lg:grid-cols-[3fr_2fr]">
        {flow ? <EnergyFlow v={flow} /> : <Skeleton className="h-60 opacity-20" />}
        <div>
          <p className="text-sm text-slate-400">Aliran saat ini, {d?.scopeLabel ?? "memuat"}</p>
          <ul className="mt-3 space-y-2 text-sm text-slate-300">
            <li>PV memasok beban lebih dulu, lalu mengisi baterai.</li>
            <li>Saat PV kurang, baterai menutup kekurangan hingga batas SoC.</li>
            <li>PLN menutup sisanya. Tidak ada kredit ekspor, sehingga surplus saat baterai penuh tidak terpakai.</li>
          </ul>
        </div>
      </section>

      <div className="flex items-center gap-1">
        <Button size="sm" variant={day === "yesterday" ? "primary" : "ghost"} aria-pressed={day === "yesterday"} onClick={() => setDay("yesterday")}>Kemarin, sehari penuh</Button>
        <Button size="sm" variant={day === "today" ? "primary" : "ghost"} aria-pressed={day === "today"} onClick={() => setDay("today")}>Hari ini, sampai waktu simulasi</Button>
      </div>

      {!tot || !selected || !d || !sankey ? <Skeleton className="h-96 rounded-2xl" /> : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <StatTile label="Kemandirian energi" value={num(selfSufficiency * 100, 1)} unit="%" foot="Beban dari PV dan baterai" />
            <StatTile label="Pemakaian surya sendiri" value={num(selfConsumption * 100, 1)} unit="%" foot="Produksi PV yang terpakai" />
            <StatTile label="Impor PLN" value={num(tot.pln, 1)} unit="kWh" foot={`Beban total ${num(tot.load, 0)} kWh`} />
            <StatTile label="Estimasi penghematan" value={rupiah(avoided * d.tariffRp)} foot={`Tarif ${rupiah(d.tariffRp)}/kWh, tanpa kredit ekspor`} />
            <StatTile label="Estimasi CO₂ dihindari" value={num(avoided * d.emissionFactor, 0)} unit="kg" foot={`Faktor ${num(d.emissionFactor, 2)} kg CO₂/kWh`} />
          </div>
          <div className="grid gap-4 xl:grid-cols-5">
            <Card className="xl:col-span-3">
              <CardHeader title="Neraca energi" description={`Dalam kWh. Selisih neraca ${num(Math.abs(balance), 1)} kWh.`} />
              <div className="px-4 pb-3 pt-2"><EChart option={sankey} style={{ height: 320 }} ariaLabel="Diagram Sankey aliran energi harian" /></div>
            </Card>
            <Card className="xl:col-span-2 p-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-ink"><Lightbulb className="h-4 w-4 text-sun" aria-hidden /> Rekomendasi</h2>
              {d.recommendations.length === 0 ? <p className="mt-2 text-sm text-ink-3">Belum ada rekomendasi untuk data ini.</p> : (
                <ul className="mt-3 space-y-3 text-sm text-ink-2">{d.recommendations.map((r) => <li key={r}>{r}</li>)}</ul>
              )}
              <DisclaimerNote className="mt-3">Berbasis aturan dari data kemarin. Efisiensi bolak-balik baterai diasumsikan sekitar 90%.</DisclaimerNote>
            </Card>
          </div>
          <Card>
            <CardHeader title="Sumber energi untuk beban" description="Porsi PV langsung, baterai, dan PLN sepanjang hari" />
            <div className="px-4 pb-3 pt-2"><SourceChart curve={selected.curve} dayStart={day === "today" ? d.dayStart : d.dayStart - 86400} /></div>
          </Card>
          <Card className="p-5">
            <h2 className="text-sm font-semibold text-ink">Batas pengukuran</h2>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[480px] text-sm">
                <thead><tr className="border-b border-line text-left text-xs text-ink-3"><th scope="col" className="py-1.5 pr-4 font-medium">Meter</th><th scope="col" className="py-1.5 pr-4 font-medium">Lokasi</th><th scope="col" className="py-1.5 font-medium">Mengukur</th></tr></thead>
                <tbody className="text-ink-2">
                  <tr className="border-b border-line"><td className="num py-1.5 pr-4">M1</td><td className="py-1.5 pr-4">Keluaran AC inverter tiap rumah</td><td className="py-1.5">Produksi PV</td></tr>
                  <tr className="border-b border-line"><td className="num py-1.5 pr-4">M2</td><td className="py-1.5 pr-4">Panel beban tiap rumah</td><td className="py-1.5">Beban rumah</td></tr>
                  <tr className="border-b border-line"><td className="num py-1.5 pr-4">M3</td><td className="py-1.5 pr-4">Bus gang, bank baterai</td><td className="py-1.5">Pengisian dan pengosongan</td></tr>
                  <tr><td className="num py-1.5 pr-4">M4</td><td className="py-1.5 pr-4">Bus gang, sambungan PLN</td><td className="py-1.5">Impor PLN</td></tr>
                </tbody>
              </table>
            </div>
            <DisclaimerNote className="mt-3">Neraca: PV + impor PLN + pengosongan = beban + pengisian + tidak terpakai. Data simulasi. Penghematan dan CO₂ adalah estimasi.</DisclaimerNote>
          </Card>
        </>
      )}
    </div>
  );
}
