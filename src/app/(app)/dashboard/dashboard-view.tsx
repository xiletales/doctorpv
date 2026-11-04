"use client";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, BrainCircuit, X } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { axisTooltip, EChart, grid, legend, timeAxis, tooltip, useChartTheme, valueAxis } from "@/components/charts/echart";
import { DisclaimerNote, EmptyState, ErrorState, PriorityBadge, StatusBadge } from "@/components/domain/status";
import { EnergyFlow, type FlowValues } from "@/components/domain/energy-flow";
import { SunArc } from "@/components/domain/sun-arc";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, Skeleton } from "@/components/ui/card";
import { byPriority, type AlertDto } from "@/lib/alerts/dto";
import { apiGet } from "@/lib/client";
import { clockTime, dateTime, num, rupiah } from "@/lib/format";
import type { OverviewDto } from "@/lib/overview";
import { NAV } from "@/lib/rbac";
import { cn } from "@/lib/utils";
import { useLive } from "@/stores/live";
import { useUi } from "@/stores/ui";

function assetHref(assetType: string, assetId: string): string {
  if (assetType === "pv") return `/solar/${assetId}`;
  if (assetType === "battery") return `/batteries/${assetId}`;
  return "/alerts";
}

/** Links only to pages that exist in this build, so that no click ever lands on a 404. */
function AssetLink({ href, className, children }: { href: string; className: string; children: React.ReactNode }) {
  if (!NAV.some((n) => href === n.href || href.startsWith(`${n.href}/`))) return <div className={className}>{children}</div>;
  return <Link href={href} className={className}>{children}</Link>;
}

function Delta({ now, before, unit, goodUp = true }: { now: number; before: number; unit: string; goodUp?: boolean }) {
  const diff = now - before;
  const pct = before > 0 ? (diff / before) * 100 : 0;
  const up = diff >= 0;
  const good = up === goodUp;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-[11px]", good ? "text-st-normal" : "text-st-warning")}>
      <Icon className="h-3 w-3" aria-hidden />
      {num(Math.abs(unit === "poin" ? diff : pct), 1)}{unit === "poin" ? " poin" : "%"}
      <span className="sr-only">{up ? "naik" : "turun"} dibanding kemarin</span>
    </span>
  );
}

function Kpi({ label, value, unit, foot }: { label: string; value: string; unit?: string; foot?: React.ReactNode }) {
  return (
    <div className="min-w-0 px-4 py-3">
      <p className="truncate text-xs text-ink-3">{label}</p>
      <p className="mt-1 flex items-baseline gap-1">
        <span className="num text-xl font-semibold tracking-tight text-ink">{value}</span>
        {unit ? <span className="text-xs text-ink-3">{unit}</span> : null}
      </p>
      <div className="mt-0.5 min-h-4 text-[11px] text-ink-3">{foot}</div>
    </div>
  );
}

function ProductionChart({ data }: { data: OverviewDto }) {
  const t = useChartTheme();
  const option = useMemo(() => {
    const minX = data.dayStart * 1000 + 5 * 3600 * 1000;
    const maxX = data.dayStart * 1000 + 19 * 3600 * 1000;
    return {
      animation: false,
      tooltip: { ...tooltip(t), formatter: axisTooltip("kW") },
      legend: legend(t),
      grid: grid(),
      xAxis: timeAxis(t, "clock", { min: minX, max: maxX }),
      yAxis: valueAxis(t, "kW"),
      series: [
        { name: "Ekspektasi cerah", type: "line", showSymbol: false, data: data.expected.map((p) => [p.ts * 1000, p.w / 1000]), lineStyle: { color: t.faint, width: 1.5, type: "dashed" }, itemStyle: { color: t.faint } },
        { name: "Kemarin", type: "line", showSymbol: false, data: data.yesterday.map((p) => [p.ts * 1000, p.pv / 1000]), lineStyle: { color: t.muted, width: 1.5 }, itemStyle: { color: t.muted } },
        { name: "Hari ini", type: "line", showSymbol: false, data: data.today.map((p) => [p.ts * 1000, p.pv / 1000]), lineStyle: { color: t.pv, width: 2.5 }, itemStyle: { color: t.pv }, areaStyle: { color: t.pv, opacity: 0.12 } },
      ],
    };
  }, [data, t]);
  return <EChart option={option} style={{ height: 345 }} ariaLabel="Produksi PV hari ini dibanding kemarin dan ekspektasi cerah" />;
}

function BalanceChart({ data }: { data: OverviewDto }) {
  const t = useChartTheme();
  const option = useMemo(() => {
    const pts = data.yesterday.filter((p) => p.ts >= data.simTs).map((p) => [p.ts * 1000, p.load / 1000]);
    return {
      animation: false,
      tooltip: { ...tooltip(t), formatter: axisTooltip("kW") },
      legend: legend(t),
      grid: grid(),
      xAxis: timeAxis(t, "clock", { min: data.dayStart * 1000, max: (data.dayStart + 86400) * 1000 }),
      yAxis: valueAxis(t, "kW"),
      series: [
        { name: "Beban hari ini", type: "line", showSymbol: false, data: data.today.map((p) => [p.ts * 1000, p.load / 1000]), lineStyle: { color: t.load, width: 2.5 }, itemStyle: { color: t.load } },
        { name: "PV hari ini", type: "line", showSymbol: false, data: data.today.map((p) => [p.ts * 1000, p.pv / 1000]), lineStyle: { color: t.pv, width: 2 }, itemStyle: { color: t.pv } },
        { name: "Beban pola kemarin", type: "line", showSymbol: false, data: pts, lineStyle: { color: t.load, width: 1.5, type: "dashed", opacity: 0.6 }, itemStyle: { color: t.load } },
      ],
    };
  }, [data, t]);
  return <EChart option={option} style={{ height: 230 }} ariaLabel="Beban rumah dibanding produksi PV" />;
}

function SocSohChart({ data }: { data: OverviewDto }) {
  const t = useChartTheme();
  const option = useMemo(() => ({
    animation: false,
    tooltip: { ...tooltip(t), formatter: axisTooltip("%", "date") },
    legend: legend(t),
    grid: grid({ left: 34 }),
    xAxis: timeAxis(t, "date"),
    yAxis: valueAxis(t, "%", { min: 0, max: 100 }),
    series: [
      { name: "SoH rata-rata", type: "line", showSymbol: false, data: data.trend.map((p) => [p.ts * 1000, p.soh]), lineStyle: { color: t.battery, width: 2.5 }, itemStyle: { color: t.battery } },
      { name: "SoC rata-rata", type: "line", showSymbol: false, data: data.trend.map((p) => [p.ts * 1000, p.soc]), lineStyle: { color: t.load, width: 2 }, itemStyle: { color: t.load } },
    ],
  }), [data, t]);
  return <EChart option={option} style={{ height: 230 }} ariaLabel="Tren SoC dan SoH rata-rata 30 hari" />;
}

function PrChart({ data }: { data: OverviewDto }) {
  const t = useChartTheme();
  const option = useMemo(() => ({
    animation: false,
    tooltip: { ...tooltip(t), formatter: (params: { value: [number, number] }[]) => `${new Intl.NumberFormat("id-ID", { style: "percent", maximumFractionDigits: 1 }).format(params[0].value[1])}` },
    grid: grid({ left: 38, top: 16 }),
    xAxis: timeAxis(t, "date"),
    yAxis: valueAxis(t, "", { min: 0.5, max: 1, axisLabel: { color: t.text, fontSize: 11, formatter: (v: number) => `${Math.round(v * 100)}%` } }),
    series: [{ name: "Performance ratio", type: "line", showSymbol: false, data: data.trend.filter((p) => p.pr > 0).map((p) => [p.ts * 1000, p.pr]), lineStyle: { color: t.pv, width: 2.5 }, itemStyle: { color: t.pv } }],
  }), [data, t]);
  return <EChart option={option} style={{ height: 230 }} ariaLabel="Performance ratio 30 hari" />;
}

function FaultsChart({ data }: { data: OverviewDto }) {
  const t = useChartTheme();
  const option = useMemo(() => {
    const names = data.faultsByGang.map((g) => g.gangId.replace("G", "Gang "));
    const bar = (name: string, key: "critical" | "high" | "medium" | "low", color: string) => ({
      name, type: "bar", stack: "s", barWidth: 22, data: data.faultsByGang.map((g) => g[key]),
      itemStyle: { color, borderColor: t.surface, borderWidth: 2, borderRadius: 3 },
    });
    return {
      animation: false,
      tooltip: { ...tooltip(t), axisPointer: { type: "shadow", shadowStyle: { color: "transparent" } } },
      legend: legend(t),
      grid: grid({ left: 54, right: 14, bottom: 20 }),
      xAxis: { type: "value", minInterval: 1, axisLabel: { color: t.text, fontSize: 11 }, splitLine: { lineStyle: { color: t.grid } } },
      yAxis: { type: "category", data: names, inverse: true, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: t.text, fontSize: 12 } },
      series: [bar("Kritis", "critical", t.critical), bar("Tinggi", "high", t.high), bar("Sedang", "medium", t.warning), bar("Rendah", "low", t.low)],
    };
  }, [data, t]);
  return <EChart option={option} style={{ height: 230 }} ariaLabel="Jumlah alert terbuka per gang menurut prioritas" />;
}

function GangStrip() {
  const gangs = useLive((s) => s.snapshot?.gangs);
  const selected = useUi((s) => s.gangId);
  const setGang = useUi((s) => s.setGang);
  if (!gangs) return <Skeleton className="h-24" />;
  const accent = { normal: "bg-st-normal", warning: "bg-st-warning", critical: "bg-st-critical", offline: "bg-st-offline", maintenance: "bg-st-maintenance" } as const;
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-5">
      {gangs.map((g) => {
        const active = selected === g.id;
        return (
          <button
            key={g.id}
            type="button"
            aria-pressed={active}
            onClick={() => setGang(active ? null : g.id)}
            className={cn("relative overflow-hidden rounded-xl border bg-surface py-3 pl-4 pr-3 text-left transition-colors hover:border-ink-3", active ? "border-primary ring-1 ring-primary" : "border-line")}
          >
            <span className={cn("absolute inset-y-0 left-0 w-1", accent[g.status])} aria-hidden />
            <span className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-ink">{g.id.replace("G", "Gang ")}</span>
              <StatusBadge status={g.status} />
            </span>
            <span className="mt-2 grid grid-cols-3 gap-1 text-xs text-ink-3">
              <span><span className="num block text-sm font-medium text-ink">{num(g.pvW / 1000, 1)}</span>kW PV</span>
              <span><span className="num block text-sm font-medium text-ink">{num(g.avgSoc, 0)}%</span>SoC</span>
              <span><span className="num block text-sm font-medium text-ink">{g.critical + g.warning}</span>alert</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Hero() {
  const snapshot = useLive((s) => s.snapshot);
  const gangId = useUi((s) => s.gangId);
  const flow = useMemo<FlowValues | null>(() => {
    if (!snapshot) return null;
    const list = gangId ? snapshot.gangs.filter((g) => g.id === gangId) : snapshot.gangs;
    const sum = (f: (g: (typeof list)[number]) => number) => list.reduce((a, g) => a + f(g), 0);
    return { pvW: sum((g) => g.pvW), loadW: sum((g) => g.loadW), plnW: sum((g) => g.plnW), chargeW: sum((g) => g.chargeW), dischargeW: sum((g) => g.dischargeW), curtailW: sum((g) => g.curtailW), soc: sum((g) => g.avgSoc) / Math.max(list.length, 1) };
  }, [snapshot, gangId]);
  if (!snapshot || !flow) return <Skeleton className="h-64 rounded-2xl" />;
  const irr = snapshot.gangs[0]?.irradiance ?? 0;
  return (
    <section className="grid gap-4 overflow-hidden rounded-2xl bg-rail p-5 text-white lg:grid-cols-[1.25fr_1fr] lg:p-6">
      <div className="flex min-w-0 flex-col justify-between gap-3">
        <div>
          <p className="text-sm text-slate-400">Daya surya {gangId ? gangId.replace("G", "Gang ") : "seluruh RT"} pukul {clockTime(snapshot.simTs)} WIB</p>
          <p className="mt-1 flex items-baseline gap-2">
            <span className="num text-5xl font-semibold tracking-tight">{num(flow.pvW / 1000, 1)}</span>
            <span className="text-lg text-slate-300">kW</span>
          </p>
          <p className="mt-1 text-sm text-slate-400">Iradiasi {num(irr, 0)} W/m², suhu udara {num(snapshot.gangs[0]?.ambientC ?? 0, 1)} °C</p>
        </div>
        <SunArc ts={snapshot.simTs} irradiance={irr} />
      </div>
      <div className="flex items-center"><EnergyFlow v={flow} /></div>
    </section>
  );
}

function PriorityList({ alerts }: { alerts: AlertDto[] }) {
  const top = [...alerts].filter((a) => a.priority !== "low").sort(byPriority).slice(0, 4);
  if (top.length === 0) return <EmptyState title="Tidak ada prioritas terbuka" hint="Semua aset berjalan normal." />;
  return (
    <ol className="divide-y divide-line">
      {top.map((a) => {
        const cause = a.diagnosis?.causes[0];
        return (
          <li key={a.id}>
            <AssetLink href={assetHref(a.assetType, a.assetId)} className="block px-5 py-3 hover:bg-surface-2">
              <div className="flex items-center justify-between gap-2">
                <span className="num text-sm font-medium text-ink">{a.assetId}</span>
                <PriorityBadge priority={a.priority} />
              </div>
              {cause ? (
                <p className="mt-1 text-xs text-ink-2">{cause.label} <span className="text-ink-3">(estimasi {Math.round(cause.probability * 100)}%)</span></p>
              ) : (
                <p className="mt-1 text-xs text-ink-2">{a.message}</p>
              )}
              <p className="mt-0.5 text-xs text-ink-3">{a.recommendedAction}</p>
            </AssetLink>
          </li>
        );
      })}
    </ol>
  );
}

function LatestAlerts({ alerts }: { alerts: AlertDto[] }) {
  const list = alerts.slice(0, 6);
  if (list.length === 0) return <EmptyState title="Belum ada alert" />;
  return (
    <ul className="divide-y divide-line">
      {list.map((a) => (
        <li key={a.id} className="flex items-start justify-between gap-3 px-5 py-2.5">
          <div className="min-w-0">
            <p className="text-sm text-ink">{a.message}</p>
            <p className="text-xs text-ink-3">{dateTime(a.createdAt)}, {a.gangId.replace("G", "Gang ")}</p>
          </div>
          <PriorityBadge priority={a.priority} />
        </li>
      ))}
    </ul>
  );
}

function LowestPv() {
  const pv = useLive((s) => s.snapshot?.pv);
  const gangId = useUi((s) => s.gangId);
  const list = useMemo(() => (pv ?? []).filter((p) => (!gangId || p.gangId === gangId) && p.status !== "offline" && p.status !== "maintenance").sort((a, b) => a.ratio - b.ratio).slice(0, 5), [pv, gangId]);
  return (
    <ul className="divide-y divide-line">
      {list.map((p) => (
        <li key={p.id}>
          <AssetLink href={`/solar/${p.id}`} className="flex items-center justify-between gap-3 px-5 py-2.5 hover:bg-surface-2">
            <span className="num text-sm text-ink">{p.id}</span>
            <span className="flex items-center gap-3">
              <span className="whitespace-nowrap text-xs text-ink-2">{num(p.ratio * 100, 0)}% ekspektasi</span>
              <StatusBadge status={p.status} />
            </span>
          </AssetLink>
        </li>
      ))}
    </ul>
  );
}

function BatteriesToInspect() {
  const batteries = useLive((s) => s.snapshot?.batteries);
  const gangId = useUi((s) => s.gangId);
  const list = useMemo(() => (batteries ?? []).filter((b) => !gangId || b.gangId === gangId).sort((a, b) => a.health - b.health).slice(0, 5), [batteries, gangId]);
  return (
    <ul className="divide-y divide-line">
      {list.map((b) => (
        <li key={b.id}>
          <AssetLink href={`/batteries/${b.id}`} className="flex items-center justify-between gap-3 px-5 py-2.5 hover:bg-surface-2">
            <span className="num text-sm text-ink">{b.id}</span>
            <span className="flex items-center gap-3">
              <span className="whitespace-nowrap text-xs text-ink-2">SoH {num(b.soh, 1)}%</span>
              <StatusBadge status={b.status} />
            </span>
          </AssetLink>
        </li>
      ))}
    </ul>
  );
}

export function DashboardView() {
  const gangId = useUi((s) => s.gangId);
  const setGang = useUi((s) => s.setGang);
  const snapshot = useLive((s) => s.snapshot);
  const overview = useQuery({
    queryKey: ["overview", gangId],
    queryFn: () => apiGet<OverviewDto>(`/api/v1/overview${gangId ? `?gangId=${gangId}` : ""}`),
    refetchInterval: 30_000,
  });
  const alerts = useQuery({
    queryKey: ["alerts", "active", gangId],
    queryFn: () => apiGet<{ alerts: AlertDto[] }>(`/api/v1/alerts?active=true${gangId ? `&gangId=${gangId}` : ""}`),
  });

  const d = overview.data;
  const liveFaults = alerts.data?.alerts.filter((a) => a.priority !== "low").length ?? d?.kpi.activeFaults ?? 0;
  const activePv = snapshot ? snapshot.pv.filter((p) => (!gangId || p.gangId === gangId) && p.status !== "offline" && p.inverter !== "TRIP").length : d?.kpi.activePv ?? 0;

  return (
    <div className="space-y-4 p-4 md:p-6">
      <h1 className="sr-only">Ringkasan energi RT</h1>
      <Hero />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">Status gang</h2>
        {gangId ? (
          <Button size="sm" variant="ghost" onClick={() => setGang(null)}>
            <X className="h-3 w-3" aria-hidden /> Tampilkan seluruh RT
          </Button>
        ) : <span className="text-xs text-ink-3">Pilih gang untuk memfilter halaman ini</span>}
      </div>
      <GangStrip />

      {overview.isError ? (
        <Card><ErrorState message={(overview.error as Error).message} /></Card>
      ) : !d ? (
        <Skeleton className="h-24 rounded-2xl" />
      ) : (
        <Card className="grid grid-cols-2 divide-line sm:grid-cols-3 lg:grid-cols-5 [&>*]:border-line [&>*]:border-b lg:[&>*:nth-last-child(-n+5)]:border-b-0">
          <Kpi label="Rumah" value={num(d.kpi.houses)} unit="unit" foot={`${d.kpi.gangs} gang`} />
          <Kpi label="PV aktif" value={num(activePv)} unit={`dari ${d.kpi.houses}`} foot="Instalasi atap" />
          <Kpi label="Baterai" value={num(d.kpi.batteries)} unit="unit" foot={`SoH rata-rata ${num(d.kpi.avgSoh, 1)}%`} />
          <Kpi label="Gangguan aktif" value={num(liveFaults)} unit="alert" foot="Tanpa prioritas rendah" />
          <Kpi label="Perintah kerja terbuka" value={num(d.kpi.openWorkOrders)} unit="WO" foot="Pemeliharaan" />
          <Kpi label="Produksi PV hari ini" value={num(d.kpi.pvKwh, 1)} unit="kWh" foot={<Delta now={d.kpi.pvKwh} before={d.kpi.pvKwhYesterday} unit="%" />} />
          <Kpi label="Konsumsi hari ini" value={num(d.kpi.loadKwh, 1)} unit="kWh" foot={<Delta now={d.kpi.loadKwh} before={d.kpi.loadKwhYesterday} unit="%" goodUp={false} />} />
          <Kpi label="Kemandirian energi" value={num(d.kpi.selfSufficiency * 100, 1)} unit="%" foot={<Delta now={d.kpi.selfSufficiency * 100} before={d.kpi.selfSufficiencyYesterday * 100} unit="poin" />} />
          <Kpi label="Estimasi penghematan" value={rupiah(d.kpi.savingsRp)} foot="Hari ini, tanpa kredit ekspor" />
          <Kpi label="Estimasi CO₂ dihindari" value={num(d.kpi.avoidedKg, 0)} unit="kg" foot="Hari ini" />
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Produksi PV" description={d ? `${d.scopeLabel}. Dibanding kemarin dan ekspektasi langit cerah.` : undefined} />
          <div className="px-4 pb-3 pt-2">{d ? <ProductionChart data={d} /> : <Skeleton className="h-[345px]" />}</div>
        </Card>
        <Card>
          <CardHeader title="Prioritas hari ini" description="Diurutkan dari alert dan estimasi diagnosis AI" action={<BrainCircuit className="h-4 w-4 text-ink-3" aria-hidden />} />
          <div className="mt-2 pb-2">{alerts.data ? <PriorityList alerts={alerts.data.alerts} /> : <Skeleton className="mx-5 h-48" />}</div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardHeader title="Beban dan produksi" description="Beban malam memakai baterai, lalu PLN" />
          <div className="px-4 pb-3 pt-2">{d ? <BalanceChart data={d} /> : <Skeleton className="h-[230px]" />}</div>
        </Card>
        <Card>
          <CardHeader title="SoC dan SoH rata-rata" description="30 hari terakhir" />
          <div className="px-4 pb-3 pt-2">{d ? <SocSohChart data={d} /> : <Skeleton className="h-[230px]" />}</div>
        </Card>
        <Card>
          <CardHeader title="Performance ratio" description="30 hari terakhir, ternormalisasi iradiasi" />
          <div className="px-4 pb-3 pt-2">{d ? <PrChart data={d} /> : <Skeleton className="h-[230px]" />}</div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
        <Card className="xl:col-span-2">
          <CardHeader title="Alert terbaru" />
          <div className="mt-1 pb-1">{alerts.data ? <LatestAlerts alerts={alerts.data.alerts} /> : <Skeleton className="mx-5 h-48" />}</div>
        </Card>
        <Card>
          <CardHeader title="PV terendah" description="Terhadap ekspektasi saat ini" />
          <div className="mt-1 pb-1"><LowestPv /></div>
        </Card>
        <Card>
          <CardHeader title="Baterai perlu inspeksi" description="Skor kesehatan terendah" />
          <div className="mt-1 pb-1"><BatteriesToInspect /></div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader title="Alert terbuka per gang" description="Menurut prioritas" />
          <div className="px-4 pb-3 pt-2">{d ? <FaultsChart data={d} /> : <Skeleton className="h-[230px]" />}</div>
        </Card>
        <Card className="xl:col-span-2 p-5">
          <h2 className="text-sm font-semibold text-ink">Cara membaca angka di halaman ini</h2>
          <ul className="mt-2 max-w-2xl space-y-1.5 text-sm text-ink-2">
            <li>Kemandirian energi adalah porsi beban yang dipenuhi PV dan baterai, bukan PLN.</li>
            <li>Estimasi penghematan memakai tarif {rupiah(1444.7)}/kWh. Surplus PV tidak dihitung sebagai kredit ekspor, karena diasumsikan tidak ada kredit ekspor.</li>
            <li>Estimasi CO₂ dihindari memakai faktor emisi jaringan {num(0.87, 2)} kg CO₂/kWh.</li>
          </ul>
          <DisclaimerNote className="mt-3">Data simulasi untuk keperluan prototipe. Tarif dan faktor emisi adalah asumsi yang dapat diubah.</DisclaimerNote>
        </Card>
      </div>
    </div>
  );
}
