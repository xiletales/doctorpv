"use client";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { axisTooltip, EChart, grid, legend, timeAxis, tooltip, useChartTheme, valueAxis } from "@/components/charts/echart";
import { AlertTimeline, DetailHeader, HealthCard, LiveRingChart, StatTile } from "@/components/domain/asset-parts";
import { DisclaimerNote, ErrorState } from "@/components/domain/status";
import { Card, CardHeader, Skeleton } from "@/components/ui/card";
import { VERDICT_LABEL } from "@/lib/ai/assess";
import { apiGet } from "@/lib/client";
import type { HouseDetail } from "@/lib/detail-dto";
import { longDate, num } from "@/lib/format";
import type { PvLive, RingPoint } from "@/lib/live/store";
import { facilityOf } from "@/lib/site";
import { useLive } from "@/stores/live";

const pickPower = (p: RingPoint) => p.a / 1000;

function TodayChart({ d, live }: { d: HouseDetail; live?: PvLive }) {
  const t = useChartTheme();
  const option = useMemo(() => {
    const actual = d.today.map((p) => [p.ts * 1000, p.actual / 1000]);
    const expected = d.today.map((p) => [p.ts * 1000, p.expected / 1000]);
    // The newest point is the live reading, so a fault shows on the curve the moment it happens.
    if (live) {
      actual.push([d.simTs * 1000 + 1, live.acW / 1000]);
      expected.push([d.simTs * 1000 + 1, live.expectedW / 1000]);
    }
    return {
      animation: false,
      tooltip: { ...tooltip(t), formatter: axisTooltip("kW", "clock", 2) },
      legend: legend(t),
      grid: grid(),
      xAxis: timeAxis(t, "clock", { min: (d.dayStart + 5 * 3600) * 1000, max: (d.dayStart + 19 * 3600) * 1000 }),
      yAxis: valueAxis(t, "kW"),
      series: [
        { name: "Ekspektasi", type: "line", showSymbol: false, data: expected, lineStyle: { color: t.muted, width: 2, type: "dashed" }, itemStyle: { color: t.muted } },
        { name: "Aktual", type: "line", showSymbol: false, data: actual, lineStyle: { color: t.pv, width: 2.5 }, itemStyle: { color: t.pv }, areaStyle: { color: t.pv, opacity: 0.12 } },
      ],
    };
  }, [d, t, live]);
  return <EChart option={option} style={{ height: 320 }} ariaLabel="Daya aktual dibanding ekspektasi hari ini" />;
}

function DailyChart({ d }: { d: HouseDetail }) {
  const t = useChartTheme();
  const option = useMemo(() => ({
    animation: false,
    tooltip: { ...tooltip(t), axisPointer: { type: "shadow", shadowStyle: { color: "transparent" } }, formatter: axisTooltip("kWh", "date") },
    legend: legend(t),
    grid: grid(),
    xAxis: timeAxis(t, "date"),
    yAxis: valueAxis(t, "kWh"),
    series: [
      {
        name: "Energi aktual", type: "bar", data: d.daily.map((p) => [p.ts * 1000, p.kwh]), itemStyle: { color: t.pv, borderRadius: [3, 3, 0, 0] },
        markArea: {
          silent: true,
          itemStyle: { color: t.critical, opacity: 0.08 },
          label: { show: false },
          data: d.anomalies.filter((a) => a.payload.metric === "acPowerW").map((a) => [{ xAxis: a.payload.from * 1000 - 43200000 }, { xAxis: a.payload.to * 1000 + 43200000 }]),
        },
      },
      { name: "Energi ekspektasi", type: "line", showSymbol: false, data: d.daily.map((p) => [p.ts * 1000, p.expectedKwh]), lineStyle: { color: t.muted, width: 2, type: "dashed" }, itemStyle: { color: t.muted } },
    ],
  }), [d, t]);
  return <EChart option={option} style={{ height: 240 }} ariaLabel="Energi harian 30 hari dengan penanda anomali" />;
}

function RatioChart({ d }: { d: HouseDetail }) {
  const t = useChartTheme();
  const option = useMemo(() => ({
    animation: false,
    tooltip: { ...tooltip(t), formatter: (p: { value: [number, number] }[]) => `${num(p[0].value[1] * 100, 0)}% dari ekspektasi` },
    grid: grid({ top: 14, left: 38 }),
    xAxis: timeAxis(t, "date"),
    yAxis: valueAxis(t, "", { min: 0, max: 1.2, axisLabel: { color: t.text, fontSize: 11, formatter: (v: number) => `${Math.round(v * 100)}%` } }),
    series: [{
      name: "Rasio", type: "line", showSymbol: false, data: d.daily.map((p) => [p.ts * 1000, p.ratio]), lineStyle: { color: t.pv, width: 2.5 }, itemStyle: { color: t.pv },
      markLine: { silent: true, symbol: "none", lineStyle: { color: t.muted, type: "dashed" }, label: { formatter: "Batas waspada 80%", color: t.text, fontSize: 11, position: "insideEndTop" }, data: [{ yAxis: 0.8 }] },
    }],
  }), [d, t]);
  return <EChart option={option} style={{ height: 240 }} ariaLabel="Rasio aktual terhadap ekspektasi per hari" />;
}

export function SolarDetailView({ id }: { id: string }) {
  const q = useQuery({ queryKey: ["house", id], queryFn: () => apiGet<HouseDetail>(`/api/v1/houses/${id}`) });
  const p = useLive((s) => s.snapshot?.pv.find((x) => x.id === id));
  if (q.isError) return <div className="p-6"><ErrorState message={(q.error as Error).message} /></div>;
  const d = q.data;
  if (!d) return <div className="space-y-4 p-6"><Skeleton className="h-16" /><Skeleton className="h-72 rounded-2xl" /></div>;
  const deviation = p ? (p.ratio - 1) * 100 : 0;
  return (
    <div className="space-y-4 p-4 md:p-6">
      <DetailHeader back="/solar" backLabel="Rumah dan surya" id={id} subtitle={`${d.address}, ${d.ownerName ?? d.ownerCode}${facilityOf(id) ? ", fasilitas umum" : ""}`} status={p?.status} assetParam={id} />
      {p ? (
        <Card className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 py-3 text-sm">
          <span className="font-medium text-ink">{VERDICT_LABEL[p.verdict]}</span>
          <span className="text-ink-2">{p.verdict === "cuaca" ? "Produksi rendah karena mendung, bukan kerusakan. " : ""}Ekspektasi memakai iradiasi {num(p.irradiance, 0)} W/m² dari {p.irradianceSource === "sensor" ? "sensor titik ini" : "referensi cuaca"}.</span>
          <span className="text-xs text-ink-3">Estimasi, perlu verifikasi teknisi.</span>
        </Card>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile label="Daya AC" value={num((p?.acW ?? 0) / 1000, 2)} unit="kW" tone={p?.inverter === "TRIP" ? "bad" : undefined} foot={`Ekspektasi ${num((p?.expectedW ?? 0) / 1000, 2)} kW`} />
        <StatTile label="Deviasi dari ekspektasi" value={`${deviation > 0 ? "+" : ""}${num(deviation, 0)}`} unit="%" tone={deviation < -50 ? "bad" : deviation < -20 ? "warn" : undefined} />
        <StatTile label="DC" value={num(p?.dcV, 0)} unit={`V, ${num(p?.dcI, 1)} A`} foot={`Inverter: ${p?.inverter ?? "–"}`} />
        <StatTile label="Suhu panel" value={num(p?.tempC, 1)} unit="°C" />
        <StatTile label="Energi hari ini" value={num(p?.todayKwh, 1)} unit="kWh" foot={`${num((p?.todayKwh ?? 0) / d.capacityKwp, 2)} kWh/kWp`} />
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card>
            <CardHeader title="Aktual dan ekspektasi hari ini" description="Ekspektasi dari iradiasi terukur, suhu, dan performance ratio historis sistem ini" />
            <div className="px-4 pb-3 pt-2"><TodayChart d={d} live={p} /></div>
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card><CardHeader title="Daya langsung" description="3 menit terakhir, dalam kW" /><div className="px-4 pb-3 pt-2"><LiveRingChart id={id} seriesName="Daya" unit="kW" pick={pickPower} ariaLabel="Daya PV langsung" color="pv" min={0} /></div></Card>
            <Card>
              <CardHeader title="Identitas sistem" />
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 px-5 pb-4 pt-3 text-sm">
                <div><dt className="text-xs text-ink-3">Kapasitas</dt><dd className="num text-ink">{num(d.capacityKwp, 2)} kWp</dd></div>
                <div><dt className="text-xs text-ink-3">Panel</dt><dd className="num text-ink">{d.panelCount} unit</dd></div>
                <div><dt className="text-xs text-ink-3">Inverter</dt><dd className="text-ink">{d.inverterModel}</dd></div>
                <div><dt className="text-xs text-ink-3">Orientasi</dt><dd className="num text-ink">Tilt {d.tilt}°, azimut {d.azimuth}°</dd></div>
                <div><dt className="text-xs text-ink-3">Dipasang</dt><dd className="text-ink">{longDate(d.installDate)}</dd></div>
                <div><dt className="text-xs text-ink-3">Baterai</dt><dd className="num text-ink">{d.batteryId}</dd></div>
                <div><dt className="text-xs text-ink-3">PR historis</dt><dd className="num text-ink">{num(d.baselinePr * 100, 1)}%</dd></div>
              </dl>
            </Card>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card><CardHeader title="Energi harian" description="30 hari, area merah menandai anomali" /><div className="px-4 pb-3 pt-2"><DailyChart d={d} /></div></Card>
            <Card><CardHeader title="Rasio terhadap ekspektasi" description="30 hari terakhir" /><div className="px-4 pb-3 pt-2"><RatioChart d={d} /></div></Card>
          </div>
        </div>
        <div className="space-y-4">
          <HealthCard score={p?.health ?? d.health?.score ?? 0} health={d.health} />
          <AlertTimeline alerts={d.alerts} />
          <DisclaimerNote>Data simulasi. Diagnosis adalah estimasi dan perlu diverifikasi teknisi.</DisclaimerNote>
        </div>
      </div>
    </div>
  );
}
