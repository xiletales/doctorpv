"use client";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, BrainCircuit, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { axisTooltip, EChart, grid, legend, timeAxis, tooltip, useChartTheme, valueAxis } from "@/components/charts/echart";
import { DisclaimerNote, EmptyState, ErrorState, PriorityBadge, StatusBadge } from "@/components/domain/status";
import { EnergyFlow, type FlowValues } from "@/components/domain/energy-flow";
import { SunArc } from "@/components/domain/sun-arc";
import { PulseScoreRing } from "@/components/domain/pulse-score";
import { ClusterIsometric } from "@/components/illustrations/cluster-isometric";
import { pulseScore } from "@/lib/ai/pulse";
import { hourOfDay } from "@/lib/sim/time";
import type { TimelineDto, TimelinePoint } from "@/lib/timeline-dto";
import type { AssetStatus } from "@/lib/types";
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
import { areaLabel } from "@/lib/site";

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

function Kpi({ label, value, unit, foot, glow, big }: { label: string; value: string; unit?: string; foot?: React.ReactNode; glow?: "sun" | "grid" | "battery" | "bad"; big?: boolean }) {
  return (
    <div className={cn("min-w-0 rounded-3xl border border-line bg-surface px-4 py-3.5", glow && `glow-${glow}`, big && "sm:col-span-2")}>
      <p className="truncate text-xs text-ink-3">{label}</p>
      <p className="mt-1 flex items-baseline gap-1">
        <span className={cn("display font-semibold tracking-tight text-ink", big ? "text-4xl" : "text-2xl")}>{value}</span>
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
        { name: "Pola kemarin", type: "line", showSymbol: false, data: pts, lineStyle: { color: t.load, width: 1.5, type: "dashed", opacity: 0.6 }, itemStyle: { color: t.load } },
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
    const names = data.faultsByType.map((g) => g.label);
    const bar = (name: string, key: "critical" | "high" | "medium" | "low", color: string) => ({
      name, type: "bar", stack: "s", barWidth: 22, data: data.faultsByType.map((g) => g[key]),
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
  return <EChart option={option} style={{ height: 230 }} ariaLabel="Jumlah alert terbuka per jenis aset menurut prioritas" />;
}

function ZoneStrip() {
  const zones = useLive((s) => s.snapshot?.zones);
  const selected = useUi((s) => s.zoneId);
  const setZone = useUi((s) => s.setZone);
  if (!zones) return <Skeleton className="h-24" />;
  const accent = { normal: "bg-st-normal", warning: "bg-st-warning", critical: "bg-st-critical", offline: "bg-st-offline", maintenance: "bg-st-maintenance" } as const;
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      {zones.map((g) => {
        const active = selected === g.id;
        return (
          <button
            key={g.id}
            type="button"
            aria-pressed={active}
            onClick={() => setZone(active ? null : g.id)}
            className={cn("relative overflow-hidden rounded-3xl border bg-surface py-3.5 pl-5 pr-4 text-left transition-colors hover:border-ink-3", active ? "border-primary ring-1 ring-primary" : "border-line")}
          >
            <span className={cn("absolute inset-y-0 left-0 w-1", accent[g.status])} aria-hidden />
            <span className="flex items-center justify-between gap-2">
              <span className="display text-sm font-semibold text-ink">{areaLabel(g.id)}</span>
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

const flowFromPoint = (p: TimelinePoint): FlowValues => ({ pvW: p.pvW, loadW: p.loadW, plnW: p.plnW, chargeW: p.chargeW, dischargeW: p.dischargeW, curtailW: p.curtailW, soc: p.soc });

function Hero({ timeline, index, setIndex }: { timeline?: TimelineDto; index: number | null; setIndex: (i: number | null) => void }) {
  const snapshot = useLive((s) => s.snapshot);
  const router = useRouter();
  const [view, setView] = useState<"flow" | "cluster">("flow");
  const liveFlow = useMemo<FlowValues | null>(() => {
    if (!snapshot) return null;
    const list = snapshot.zones;
    const sum = (f: (g: (typeof list)[number]) => number) => list.reduce((a, g) => a + f(g), 0);
    return { pvW: sum((g) => g.pvW), loadW: sum((g) => g.loadW), plnW: sum((g) => g.plnW), chargeW: sum((g) => g.chargeW), dischargeW: sum((g) => g.dischargeW), curtailW: sum((g) => g.curtailW), soc: sum((g) => g.avgSoc) / Math.max(list.length, 1) };
  }, [snapshot]);
  const pulse = useMemo(() => pulseScore({
    health: [...(snapshot?.pv ?? []), ...(snapshot?.batteries ?? [])].map((a) => a.health),
    statuses: [...(snapshot?.pv ?? []), ...(snapshot?.batteries ?? [])].map((a) => a.status),
    simulatorConnected: snapshot?.simulatorConnected ?? false,
  }), [snapshot]);
  const statuses = useMemo(() => {
    const out: Record<string, AssetStatus> = {};
    for (const p of snapshot?.pv ?? []) out[p.id] = p.status;
    for (const b of snapshot?.batteries ?? []) out[b.id] = b.status;
    for (const g of snapshot?.gateways ?? []) out[g.id] = g.online ? "normal" : "offline";
    return out;
  }, [snapshot]);
  const select = useCallback((id: string) => {
    if (id.startsWith("H")) router.push(`/solar/${id}`);
    else if (id.startsWith("B")) router.push(`/batteries/${id}`);
    else router.push("/map");
  }, [router]);

  if (!snapshot || !liveFlow) return <Skeleton className="h-96 rounded-3xl" />;
  const point = index !== null ? timeline?.points[index] : undefined;
  const flow = point ? flowFromPoint(point) : liveFlow;
  const ts = point?.ts ?? snapshot.simTs;
  const irr = point?.irradiance ?? snapshot.zones[0]?.irradiance ?? 0;
  const forecast = Boolean(point && timeline && point.ts > timeline.now);
  const nowIndex = timeline ? timeline.points.findIndex((p) => p.ts >= timeline.now) : 0;

  return (
    <section className="hairline noise relative overflow-hidden rounded-3xl bg-[#0b1220] p-5 text-white lg:p-7">
      <div className="aurora" aria-hidden />
      <div className="relative grid gap-6 xl:grid-cols-[1.15fr_1fr]">
        <div className="flex min-w-0 flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-5">
            <PulseScoreRing pulse={pulse} />
            <div className="text-right">
              <p className="text-sm text-slate-400">Daya surya pukul {clockTime(ts)} WIB</p>
              <p className="flex items-baseline justify-end gap-1.5">
                <span className="display text-5xl font-semibold tracking-tight">{num(flow.pvW / 1000, 1)}</span>
                <span className="text-lg text-slate-300">kW</span>
              </p>
              <p className="text-sm text-slate-400">Iradiasi {num(irr, 0)} W/m²</p>
              <p className="text-xs text-slate-500">{snapshot.weather.label}{snapshot.weather.clearFraction < 0.7 ? `, ${num(snapshot.weather.clearFraction * 100, 0)}% dari hari cerah` : ""}</p>
            </div>
          </div>
          <SunArc ts={ts} irradiance={irr} />
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex justify-end gap-1">
            {([["flow", "Aliran energi"], ["cluster", "Tampilan klaster"]] as const).map(([k, label]) => (
              <button key={k} type="button" aria-pressed={view === k} onClick={() => setView(k)} className={cn("rounded-lg px-2.5 py-1 text-xs font-medium transition-colors", view === k ? "bg-white/15 text-white" : "text-slate-400 hover:text-white")}>{label}</button>
            ))}
          </div>
          <div className="flex flex-1 items-center justify-center">
            {view === "flow" ? <EnergyFlow v={flow} /> : (
              <div className="w-full">
                <ClusterIsometric statuses={statuses} hour={hourOfDay(ts)} onSelect={select} className="max-h-72 w-full" />
                <Link href="/map" className="mt-1 block text-center text-xs font-medium text-amber-300 hover:underline">Buka peta 3D RW 1</Link>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="relative mt-5 border-t border-white/10 pt-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <label htmlFor="time-travel" className="display text-sm font-semibold">Jelajah waktu</label>
          {point ? (
            <span className="flex items-center gap-3 text-xs">
              <span className={cn("rounded-full px-2 py-0.5 font-medium", forecast ? "bg-indigo-500/25 text-indigo-200" : "bg-white/10 text-slate-200")}>
                Menampilkan pukul {clockTime(ts)}, {forecast ? "prakiraan model" : "data tercatat"}
              </span>
              <button type="button" onClick={() => setIndex(null)} className="font-medium text-amber-300 hover:underline">Kembali ke langsung</button>
            </span>
          ) : <span className="text-xs text-slate-400">Geser untuk memutar ulang hari ini atau melihat prakiraan</span>}
        </div>
        <input
          id="time-travel"
          type="range"
          min={0}
          max={Math.max(0, (timeline?.points.length ?? 1) - 1)}
          step={1}
          disabled={!timeline}
          value={index ?? (nowIndex < 0 ? 0 : nowIndex)}
          aria-valuetext={`Pukul ${clockTime(ts)} WIB`}
          onChange={(e) => setIndex(Number(e.target.value))}
          className="time-slider w-full"
        />
        <div className="mt-1 flex justify-between text-[11px] text-slate-500" aria-hidden><span>00.00</span><span>06.00</span><span>12.00</span><span>18.00</span><span>24.00</span></div>
      </div>
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
            <p className="text-xs text-ink-3">{dateTime(a.createdAt)}, {areaLabel(a.zoneId)}</p>
          </div>
          <PriorityBadge priority={a.priority} />
        </li>
      ))}
    </ul>
  );
}

function LowestPv() {
  const pv = useLive((s) => s.snapshot?.pv);
  const zoneId = useUi((s) => s.zoneId);
  const list = useMemo(() => (pv ?? []).filter((p) => (!zoneId || p.zoneId === zoneId) && p.status !== "offline" && p.status !== "maintenance").sort((a, b) => a.ratio - b.ratio).slice(0, 5), [pv, zoneId]);
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
  const zoneId = useUi((s) => s.zoneId);
  const list = useMemo(() => (batteries ?? []).filter((b) => !zoneId || b.zoneId === zoneId).sort((a, b) => a.health - b.health).slice(0, 5), [batteries, zoneId]);
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
  const zoneId = useUi((s) => s.zoneId);
  const setZone = useUi((s) => s.setZone);
  const snapshot = useLive((s) => s.snapshot);
  const overview = useQuery({
    queryKey: ["overview", zoneId],
    queryFn: () => apiGet<OverviewDto>(`/api/v1/overview${zoneId ? `?zoneId=${zoneId}` : ""}`),
    refetchInterval: 30_000,
  });
  const alerts = useQuery({
    queryKey: ["alerts", "active", zoneId],
    queryFn: () => apiGet<{ alerts: AlertDto[] }>(`/api/v1/alerts?active=true${zoneId ? `&zoneId=${zoneId}` : ""}`),
  });

  const timelineQuery = useQuery({ queryKey: ["timeline"], queryFn: () => apiGet<TimelineDto>("/api/v1/overview/timeline"), staleTime: 300_000 });
  const [timeIndex, setTimeIndex] = useState<number | null>(null);
  const timePoint = timeIndex !== null ? timelineQuery.data?.points[timeIndex] : undefined;

  const d = overview.data;
  // While time travelling, cumulative KPIs are recomputed up to the chosen moment.
  const upTo = useMemo(() => {
    if (!timePoint || !timelineQuery.data) return null;
    const rows = timelineQuery.data.points.filter((p) => p.ts <= timePoint.ts);
    const kwh = (f: (p: TimelinePoint) => number) => (rows.reduce((a, p) => a + f(p), 0) * 300) / 3600 / 1000;
    return { pv: kwh((p) => p.pvW), load: kwh((p) => p.loadW), pln: kwh((p) => p.plnW) };
  }, [timePoint, timelineQuery.data]);
  const pvKwh = upTo?.pv ?? d?.kpi.pvKwh ?? 0;
  const loadKwh = upTo?.load ?? d?.kpi.loadKwh ?? 0;
  const plnKwh = upTo?.pln ?? d?.kpi.plnKwh ?? 0;
  const selfSufficiency = loadKwh > 0 ? 1 - plnKwh / loadKwh : 0;
  const avoided = Math.max(0, loadKwh - plnKwh);
  const savings = avoided * 1444.7;
  const liveFaults = alerts.data?.alerts.filter((a) => a.priority !== "low").length ?? d?.kpi.activeFaults ?? 0;
  const activePv = snapshot ? snapshot.pv.filter((p) => (!zoneId || p.zoneId === zoneId) && p.status !== "offline" && p.inverter !== "TRIP").length : d?.kpi.activePv ?? 0;

  return (
    <div className="space-y-4 p-4 md:p-6">
      <h1 className="sr-only">Dasbor energi klaster</h1>
      <Hero timeline={timelineQuery.data} index={timeIndex} setIndex={setTimeIndex} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="display text-[15px] font-semibold text-ink">Area RT dan gateway</h2>
        {zoneId ? (
          <Button size="sm" variant="ghost" onClick={() => setZone(null)}>
            <X className="h-3 w-3" aria-hidden /> Tampilkan seluruh klaster
          </Button>
        ) : <span className="text-xs text-ink-3">Pilih area untuk memfilter grafik dan daftar</span>}
      </div>
      <ZoneStrip />

      {overview.isError ? (
        <Card><ErrorState message={(overview.error as Error).message} /></Card>
      ) : !d ? (
        <Skeleton className="h-24 rounded-3xl" />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-6">
          <Kpi big glow="sun" label={timePoint ? `Produksi PV sampai ${clockTime(timePoint.ts)}` : "Produksi PV hari ini"} value={num(pvKwh, 1)} unit="kWh" foot={timePoint ? (timePoint.ts > d.simTs ? "Prakiraan model" : "Data tercatat") : <Delta now={d.kpi.pvKwh} before={d.kpi.pvKwhYesterday} unit="%" />} />
          <Kpi big glow="battery" label="Kemandirian energi" value={num(selfSufficiency * 100, 1)} unit="%" foot={timePoint ? "Beban dari PV dan baterai" : <Delta now={d.kpi.selfSufficiency * 100} before={d.kpi.selfSufficiencyYesterday * 100} unit="poin" />} />
          <Kpi glow="grid" label="Konsumsi" value={num(loadKwh, 1)} unit="kWh" foot={timePoint ? `Sampai ${clockTime(timePoint.ts)}` : <Delta now={d.kpi.loadKwh} before={d.kpi.loadKwhYesterday} unit="%" goodUp={false} />} />
          <Kpi label="Estimasi penghematan" value={rupiah(savings)} foot="Tanpa kredit ekspor" />
          <Kpi label="Rumah" value={num(d.kpi.houses)} unit="unit" foot="Satu PV per rumah" />
          <Kpi label="PV aktif" value={num(activePv)} unit={`dari ${d.kpi.houses}`} foot="Berproduksi" />
          <Kpi glow="battery" label="Baterai" value={num(d.kpi.batteries)} unit="unit" foot={`SoH rata-rata ${num(d.kpi.avgSoh, 1)}%`} />
          <Kpi glow={liveFaults > 0 ? "bad" : undefined} label="Gangguan aktif" value={num(liveFaults)} unit="alert" foot="Tanpa prioritas rendah" />
          <Kpi label="Perintah kerja terbuka" value={num(d.kpi.openWorkOrders)} unit="WO" foot="Pemeliharaan" />
          <Kpi label="Estimasi CO₂ dihindari" value={num(avoided * 0.87, 0)} unit="kg" foot="Faktor 0,87 kg/kWh" />
        </div>
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
          <CardHeader title="Alert terbaru" action={<Link href="/alerts" className="text-xs font-medium text-primary hover:underline">Buka pusat alert</Link>} />
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
          <CardHeader title="Alert terbuka per jenis aset" description="Menurut prioritas" />
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
