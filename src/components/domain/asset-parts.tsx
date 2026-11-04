"use client";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, MapPin } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { EChart, grid, tooltip, useChartTheme, valueAxis } from "@/components/charts/echart";
import { PriorityBadge, StatusBadge } from "@/components/domain/status";
import { HealthScoreRing } from "@/components/domain/health-ring";
import { Card, CardHeader } from "@/components/ui/card";
import type { HealthScore } from "@/lib/ai/health";
import { apiGet } from "@/lib/client";
import { COVERAGE } from "@/lib/site";
import type { AlertDto } from "@/lib/alerts/dto";
import { dateTime, num } from "@/lib/format";
import type { RingPoint } from "@/lib/live/store";
import { ALERT_STATUS_LABEL, type AssetStatus } from "@/lib/types";
import { useUi } from "@/stores/ui";
import { cn } from "@/lib/utils";

export const selectClass = "h-9 rounded-lg border border-line bg-surface px-2.5 text-sm text-ink outline-none focus:border-primary";
export const inputClass = "h-9 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-primary sm:w-56";

export function ZoneFilter() {
  const zoneId = useUi((s) => s.zoneId);
  const setZone = useUi((s) => s.setZone);
  return (
    <>
      <label htmlFor="zone-filter" className="sr-only">Filter area RT</label>
      <select id="zone-filter" value={zoneId ?? ""} onChange={(e) => setZone(e.target.value || null)} className={selectClass}>
        <option value="">Semua RT</option>
        {Object.entries(COVERAGE).map(([id, c]) => <option key={id} value={id}>{c.label}</option>)}
      </select>
    </>
  );
}

export function StatusFilter({ value, onChange }: { value: AssetStatus | ""; onChange: (v: AssetStatus | "") => void }) {
  return (
    <>
      <label htmlFor="status-filter" className="sr-only">Filter status</label>
      <select id="status-filter" value={value} onChange={(e) => onChange(e.target.value as AssetStatus | "")} className={selectClass}>
        <option value="">Semua status</option>
        <option value="normal">Normal</option>
        <option value="warning">Waspada</option>
        <option value="critical">Kritis</option>
        <option value="offline">Offline</option>
        <option value="maintenance">Pemeliharaan</option>
      </select>
    </>
  );
}

export function DetailHeader({ back, backLabel, id, subtitle, status, assetParam }: { back: string; backLabel: string; id: string; subtitle: string; status?: AssetStatus; assetParam: string }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <Link href={back} className="inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink"><ArrowLeft className="h-3 w-3" aria-hidden /> {backLabel}</Link>
        <div className="mt-1 flex flex-wrap items-center gap-2.5">
          <h1 className="num text-2xl font-semibold tracking-tight text-ink">{id}</h1>
          {status ? <StatusBadge status={status} /> : null}
        </div>
        <p className="mt-0.5 text-sm text-ink-3">{subtitle}</p>
      </div>
      <Link href={`/map?asset=${assetParam}`} className="inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-surface px-3.5 text-sm font-medium text-ink hover:bg-surface-2"><MapPin className="h-4 w-4" aria-hidden /> Lihat di peta</Link>
    </div>
  );
}

export function StatTile({ label, value, unit, tone, foot }: { label: string; value: string; unit?: string; tone?: "bad" | "warn"; foot?: string }) {
  return (
    <Card className="px-4 py-3">
      <p className="text-xs text-ink-3">{label}</p>
      <p className="mt-1 flex items-baseline gap-1">
        <span className={cn("num text-2xl font-semibold tracking-tight text-ink", tone === "bad" && "text-st-critical", tone === "warn" && "text-st-warning")}>{value}</span>
        {unit ? <span className="text-xs text-ink-3">{unit}</span> : null}
      </p>
      {foot ? <p className="mt-0.5 text-xs text-ink-3">{foot}</p> : null}
    </Card>
  );
}

export function HealthCard({ score, health }: { score: number; health: HealthScore | null }) {
  return (
    <Card className="p-5">
      <HealthScoreRing score={score} size={84} />
      {health ? (
        <ul className="mt-4 space-y-2">
          {health.factors.map((f) => (
            <li key={f.label}>
              <div className="flex justify-between gap-2 text-xs"><span className="text-ink-2">{f.label}</span><span className="num text-ink">{num(f.points, 1)}/{f.max}</span></div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-primary" style={{ width: `${(f.points / f.max) * 100}%` }} /></div>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-3 text-xs italic text-ink-3">Skor adalah estimasi dari bobot tetap, bukan hasil pemeriksaan fisik.</p>
    </Card>
  );
}

export function AlertTimeline({ alerts }: { alerts: AlertDto[] }) {
  return (
    <Card>
      <CardHeader title="Riwayat gangguan" description="Dari alert otomatis dan diagnosis" />
      {alerts.length === 0 ? (
        <p className="px-5 py-6 text-sm text-ink-3">Belum ada gangguan tercatat untuk aset ini.</p>
      ) : (
        <ol className="mt-1 divide-y divide-line pb-1">
          {alerts.map((a) => (
            <li key={a.id} className="px-5 py-3">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm text-ink">{a.message}</p>
                <PriorityBadge priority={a.priority} />
              </div>
              <p className="mt-0.5 text-xs text-ink-3">{dateTime(a.createdAt)}, {ALERT_STATUS_LABEL[a.status].toLowerCase()}</p>
              {a.diagnosis ? <p className="mt-1 text-xs text-ink-2">{a.diagnosis.summary}</p> : null}
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

/** Rolling chart of in-memory live samples, with x as seconds before the newest sample. */
export function LiveRingChart({ id, seriesName, unit, pick, ariaLabel, color, min }: { id: string; seriesName: string; unit: string; pick: (p: RingPoint) => number; ariaLabel: string; color: "pv" | "battery" | "load"; min?: number }) {
  const t = useChartTheme();
  const q = useQuery({ queryKey: ["ring", id], queryFn: () => apiGet<{ ring: RingPoint[] }>(`/api/v1/live/ring/${id}`), refetchInterval: 2000 });
  const option = useMemo(() => {
    const ring = q.data?.ring ?? [];
    const last = ring[ring.length - 1]?.t ?? 0;
    return {
      animation: false,
      tooltip: {
        ...tooltip(t),
        formatter: (params: { value: [number, number] }[]) => `${Math.abs(params[0].value[0])} detik lalu<br/><b>${num(params[0].value[1], 1)} ${unit}</b>`,
      },
      grid: grid({ top: 18, left: 44 }),
      xAxis: { type: "value", min: -180, max: 0, interval: 60, axisLabel: { color: t.text, fontSize: 11, formatter: (v: number) => (v === 0 ? "kini" : `${Math.abs(v)} dtk`) }, axisLine: { lineStyle: { color: t.grid } }, axisTick: { show: false }, splitLine: { show: false } },
      yAxis: valueAxis(t, "", {
        min: min ?? ((v: { min: number }) => Math.floor(v.min - 3)),
        max: min === undefined ? (v: { max: number }) => Math.ceil(v.max + 3) : undefined,
        axisLine: { onZero: false },
        axisTick: { show: false },
        axisLabel: { color: t.text, fontSize: 11 },
      }),
      series: [{ name: seriesName, type: "line", showSymbol: false, data: ring.map((p) => [p.t - last, pick(p)]), lineStyle: { color: t[color], width: 2.5 }, itemStyle: { color: t[color] } }],
    };
  }, [q.data, t, unit, seriesName, pick, color, min]);
  return <EChart option={option} style={{ height: 190 }} ariaLabel={ariaLabel} />;
}
