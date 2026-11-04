"use client";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { axisTooltip, EChart, grid, legend, timeAxis, tooltip, useChartTheme, valueAxis } from "@/components/charts/echart";
import { AlertTimeline, DetailHeader, HealthCard, LiveRingChart, StatTile } from "@/components/domain/asset-parts";
import { LevelBar } from "@/components/domain/health-ring";
import { DisclaimerNote, ErrorState } from "@/components/domain/status";
import { Card, CardHeader, Skeleton } from "@/components/ui/card";
import { apiGet } from "@/lib/client";
import type { BatteryDetail } from "@/lib/detail-dto";
import { longDate, num } from "@/lib/format";
import type { RingPoint } from "@/lib/live/store";
import { useLive } from "@/stores/live";

const pickTemp = (p: RingPoint) => p.a;

function SocChart({ d }: { d: BatteryDetail }) {
  const t = useChartTheme();
  const option = useMemo(() => ({
    animation: false,
    tooltip: { ...tooltip(t), formatter: axisTooltip("%") },
    grid: grid({ top: 14, left: 36 }),
    xAxis: timeAxis(t),
    yAxis: valueAxis(t, "", { min: 0, max: 100, axisLabel: { color: t.text, fontSize: 11, formatter: "{value}%" } }),
    series: [{ name: "SoC", type: "line", showSymbol: false, data: d.series.map((p) => [p.ts * 1000, p.soc]), lineStyle: { color: t.battery, width: 2.5 }, itemStyle: { color: t.battery }, areaStyle: { color: t.battery, opacity: 0.1 } }],
  }), [d, t]);
  return <EChart option={option} style={{ height: 210 }} ariaLabel="State of Charge 48 jam terakhir" />;
}

function TempChart({ d, liveTemp }: { d: BatteryDetail; liveTemp?: number }) {
  const t = useChartTheme();
  const option = useMemo(() => {
    const pts = d.series.map((p) => [p.ts * 1000, p.temp]);
    if (liveTemp !== undefined) pts.push([d.simTs * 1000, liveTemp]);
    return {
      animation: false,
      tooltip: { ...tooltip(t), formatter: axisTooltip("°C") },
      grid: grid({ top: 14, left: 36 }),
      xAxis: timeAxis(t),
      yAxis: valueAxis(t, "", { min: 20, max: (v: { max: number }) => Math.max(60, Math.ceil(v.max / 5) * 5), axisLabel: { color: t.text, fontSize: 11, formatter: "{value}°" } }),
      series: [{
        name: "Suhu", type: "line", showSymbol: false, data: pts, lineStyle: { color: t.pv, width: 2.5 }, itemStyle: { color: t.pv },
        markLine: { silent: true, symbol: "none", lineStyle: { type: "dashed", color: t.muted }, label: { color: t.text, fontSize: 11, position: "insideEndTop" }, data: [{ yAxis: 45, label: { formatter: "Waspada 45 °C" } }, { yAxis: 55, label: { formatter: "Kritis 55 °C" } }] },
      }],
    };
  }, [d, t, liveTemp]);
  return <EChart option={option} style={{ height: 210 }} ariaLabel="Suhu baterai 48 jam terakhir" />;
}

function VoltageCurrentCharts({ d }: { d: BatteryDetail }) {
  const t = useChartTheme();
  const voltage = useMemo(() => ({
    animation: false,
    tooltip: { ...tooltip(t), formatter: axisTooltip("V") },
    grid: grid({ top: 14, left: 36 }),
    xAxis: timeAxis(t),
    yAxis: valueAxis(t, "", { scale: true }),
    series: [{ name: "Tegangan", type: "line", showSymbol: false, data: d.series.map((p) => [p.ts * 1000, p.voltage]), lineStyle: { color: t.load, width: 2 }, itemStyle: { color: t.load } }],
  }), [d, t]);
  const current = useMemo(() => ({
    animation: false,
    tooltip: { ...tooltip(t), formatter: axisTooltip("A") },
    grid: grid({ top: 14, left: 36 }),
    xAxis: timeAxis(t),
    yAxis: valueAxis(t, ""),
    series: [{ name: "Arus", type: "line", showSymbol: false, data: d.series.map((p) => [p.ts * 1000, p.current]), lineStyle: { color: t.pln, width: 2 }, itemStyle: { color: t.pln } }],
  }), [d, t]);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card><CardHeader title="Tegangan" description="48 jam terakhir, dalam volt" /><div className="px-4 pb-3 pt-2"><EChart option={voltage} style={{ height: 170 }} ariaLabel="Tegangan 48 jam terakhir" /></div></Card>
      <Card><CardHeader title="Arus" description="48 jam terakhir, dalam ampere. Positif berarti mengisi." /><div className="px-4 pb-3 pt-2"><EChart option={current} style={{ height: 170 }} ariaLabel="Arus 48 jam terakhir" /></div></Card>
    </div>
  );
}

function SohForecastChart({ d }: { d: BatteryDetail }) {
  const t = useChartTheme();
  const option = useMemo(() => {
    const proj = d.forecast.projection;
    return {
      animation: false,
      tooltip: {
        ...tooltip(t),
        formatter: axisTooltip((name) => (name === "SoH tercatat" || name === "Prediksi SoH" ? "%" : ""), "date", 2),
      },
      legend: { ...legend(t), data: ["SoH tercatat", "Prediksi SoH", "Rentang 95%"] },
      grid: grid({ left: 40 }),
      xAxis: timeAxis(t, "date"),
      yAxis: valueAxis(t, "", {
        min: (v: { min: number }) => Math.floor(Math.min(v.min, 80) - 1),
        max: (v: { max: number }) => Math.ceil(v.max + 0.5),
        axisLabel: { color: t.text, fontSize: 11, formatter: "{value}%" },
      }),
      series: [
        { name: "SoH tercatat", type: "line", showSymbol: false, data: d.sohHistory.map((p) => [p.ts * 1000, p.soh]), lineStyle: { color: t.battery, width: 2.5 }, itemStyle: { color: t.battery } },
        {
          name: "Prediksi SoH", type: "line", showSymbol: false, data: proj.map((p) => [p.ts * 1000, p.value]), lineStyle: { color: t.battery, width: 2, type: "dashed" }, itemStyle: { color: t.battery },
          markLine: { silent: true, symbol: "none", label: { formatter: "Akhir masa pakai 80%", color: t.text, fontSize: 11, position: "insideStartTop" }, lineStyle: { color: t.muted, type: "dashed" }, data: [{ yAxis: 80 }] },
        },
        { name: "_lower", type: "line", stack: "band", showSymbol: false, data: proj.map((p) => [p.ts * 1000, p.lower]), lineStyle: { opacity: 0 }, tooltip: { show: false }, silent: true },
        { name: "Rentang 95%", type: "line", stack: "band", showSymbol: false, data: proj.map((p) => [p.ts * 1000, p.upper - p.lower]), lineStyle: { opacity: 0 }, areaStyle: { color: t.battery, opacity: 0.16 }, itemStyle: { color: t.battery }, tooltip: { show: false }, silent: true },
      ],
    };
  }, [d, t]);
  return <EChart option={option} style={{ height: 280 }} ariaLabel="Riwayat SoH dengan prediksi dan rentang keyakinan" />;
}

function EnergyChart({ d }: { d: BatteryDetail }) {
  const t = useChartTheme();
  const option = useMemo(() => ({
    animation: false,
    tooltip: { ...tooltip(t), axisPointer: { type: "shadow", shadowStyle: { color: "transparent" } }, formatter: axisTooltip("kWh", "date") },
    legend: legend(t),
    grid: grid(),
    xAxis: timeAxis(t, "date"),
    yAxis: valueAxis(t, "kWh"),
    series: [
      { name: "Pengisian", type: "bar", barGap: "15%", data: d.energy.map((p) => [p.ts * 1000, p.chargeKwh]), itemStyle: { color: t.battery, borderRadius: [3, 3, 0, 0] } },
      { name: "Pengosongan", type: "bar", data: d.energy.map((p) => [p.ts * 1000, p.dischargeKwh]), itemStyle: { color: t.load, borderRadius: [3, 3, 0, 0] } },
    ],
  }), [d, t]);
  return <EChart option={option} style={{ height: 210 }} ariaLabel="Energi pengisian dan pengosongan harian" />;
}

function Rul({ d }: { d: BatteryDetail }) {
  const f = d.forecast;
  if (f.pastEol) {
    return (
      <div>
        <p className="text-lg font-semibold tracking-tight text-st-warning">Melewati ambang akhir masa pakai</p>
        <p className="mt-1 text-sm text-ink-2">SoH saat ini {num(f.current, 1)}%, di bawah 80%. Disarankan uji kapasitas dan rencana penggantian.</p>
      </div>
    );
  }
  if (f.daysToEol === null) {
    return <p className="text-sm text-ink-2">Tren 30 hari belum menunjukkan penurunan yang cukup untuk memperkirakan sisa masa pakai.</p>;
  }
  return (
    <div>
      <p className="flex items-baseline gap-1.5"><span className="num text-3xl font-semibold tracking-tight text-ink">{num(f.daysToEol / 30.4, 0)}</span><span className="text-sm text-ink-3">bulan lagi</span></p>
      <p className="mt-1 text-sm text-ink-2">Estimasi hingga SoH mencapai 80%, rentang {num(f.monthsLow, 0)} sampai {num(f.monthsHigh, 0)} bulan.</p>
      <p className="mt-1 text-xs text-ink-3">Laju penurunan {num(Math.abs(f.slopePerDay) * 30.4, 2)} poin SoH per bulan.</p>
    </div>
  );
}

export function BatteryDetailView({ id }: { id: string }) {
  const q = useQuery({ queryKey: ["battery", id], queryFn: () => apiGet<BatteryDetail>(`/api/v1/batteries/${id}`) });
  const b = useLive((s) => s.snapshot?.batteries.find((x) => x.id === id));
  const peers = useLive((s) => s.snapshot?.batteries);

  if (q.isError) return <div className="p-6"><ErrorState message={(q.error as Error).message} /></div>;
  const d = q.data;
  if (!d) return <div className="space-y-4 p-6"><Skeleton className="h-16" /><Skeleton className="h-72 rounded-2xl" /></div>;
  const peerTemp = peers ? (() => {
    const list = peers.filter((p) => p.id !== id).map((p) => p.tempC).sort((x, y) => x - y);
    return list[Math.floor(list.length / 2)] ?? d.peerTemp;
  })() : d.peerTemp;

  return (
    <div className="space-y-4 p-4 md:p-6">
      <DetailHeader back="/batteries" backLabel="Kesehatan baterai" id={id} subtitle={`Melayani ${d.servedHouses.join(" dan ")}, ${d.zoneId.replace("Z", "Zona ")}, ${d.chemistry} ${num(d.capacityKwh, 2)} kWh, ${num(d.nominalVoltage, 1)} V, dipasang ${longDate(d.installDate)}`} status={b?.status} assetParam={id} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Card className="px-4 py-3">
          <p className="text-xs text-ink-3">State of Charge</p>
          <p className="num mt-1 text-2xl font-semibold tracking-tight text-ink">{num(b?.soc, 1)}<span className="ml-1 text-xs font-normal text-ink-3">%</span></p>
          <div className="mt-1.5"><LevelBar value={b?.soc ?? 0} label="State of Charge" className="bg-st-normal" /></div>
        </Card>
        <StatTile label="State of Health" value={num(b?.soh, 1)} unit="%" tone={(b?.soh ?? 100) < 80 ? "warn" : undefined} foot={`${num(b?.cycles, 0)} siklus`} />
        <StatTile label="Suhu" value={num(b?.tempC, 1)} unit="°C" tone={(b?.tempC ?? 0) >= 55 ? "bad" : (b?.tempC ?? 0) >= 45 ? "warn" : undefined} foot={`Baterai lain: ${num(peerTemp, 1)} °C`} />
        <StatTile label="Tegangan dan arus" value={num(b?.voltage, 1)} unit={`V, ${num(b?.currentA, 1)} A`} foot={(b?.currentA ?? 0) > 0.5 ? "Mengisi" : (b?.currentA ?? 0) < -0.5 ? "Mengosongkan" : "Diam"} />
        <StatTile label="Selisih tegangan sel" value={num(b?.spreadMv, 0)} unit="mV" tone={(b?.spreadMv ?? 0) >= 120 ? "warn" : undefined} foot={`Status BMS: ${b?.bms ?? "–"}`} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card>
            <CardHeader title="Tren SoH dan prediksi" description="30 hari tercatat, 180 hari diproyeksikan dengan regresi linear" />
            <div className="px-4 pb-3 pt-2"><SohForecastChart d={d} /></div>
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card><CardHeader title="Suhu langsung" description="3 menit terakhir, diperbarui tiap tick" /><div className="px-4 pb-3 pt-2"><LiveRingChart id={id} seriesName="Suhu" unit="°C" pick={pickTemp} ariaLabel="Suhu baterai langsung" color="pv" /></div></Card>
            <Card><CardHeader title="Suhu" description="48 jam terakhir" /><div className="px-4 pb-3 pt-2"><TempChart d={d} liveTemp={b?.tempC} /></div></Card>
          </div>
          <Card><CardHeader title="State of Charge" description="48 jam terakhir" /><div className="px-4 pb-3 pt-2"><SocChart d={d} /></div></Card>
          <VoltageCurrentCharts d={d} />
          <Card><CardHeader title="Energi harian" description="14 hari terakhir" /><div className="px-4 pb-3 pt-2"><EnergyChart d={d} /></div></Card>
        </div>
        <div className="space-y-4">
          <Card className="p-5">
            <h2 className="text-sm font-semibold text-ink">Estimasi sisa masa pakai</h2>
            <div className="mt-3"><Rul d={d} /></div>
            <DisclaimerNote className="mt-3">Estimasi dari tren, bukan hasil uji kapasitas. SoH diperoleh dari BMS atau diestimasi dengan metode tervalidasi, tidak diukur langsung oleh sensor sederhana.</DisclaimerNote>
          </Card>
          <HealthCard score={b?.health ?? d.health?.score ?? 0} health={d.health} />
          <AlertTimeline alerts={d.alerts} />
        </div>
      </div>
    </div>
  );
}
