"use client";
import * as Tabs from "@radix-ui/react-tabs";
import { useQuery } from "@tanstack/react-query";
import { createColumnHelper } from "@tanstack/react-table";
import { ShieldAlert, Stethoscope } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { axisTooltip, EChart, grid, legend, timeAxis, tooltip, useChartTheme, valueAxis } from "@/components/charts/echart";
import { ZoneFilter, inputClass, selectClass } from "@/components/domain/asset-parts";
import { ConfidenceBar } from "@/components/domain/confidence-bar";
import { DataTable } from "@/components/domain/data-table";
import { HealthScoreRing } from "@/components/domain/health-ring";
import { DisclaimerNote, EmptyState, ErrorState, PageTitle, PriorityBadge, StatusBadge } from "@/components/domain/status";
import { Card, CardHeader, Skeleton } from "@/components/ui/card";
import type { AnomalyMethod } from "@/lib/ai/anomaly";
import type { AnomalyDto, AnomalySeries, HealthRow } from "@/lib/ai/dto";
import { BAND_LABEL } from "@/lib/ai/health";
import { apiGet } from "@/lib/client";
import { dateTime, num, shortDate } from "@/lib/format";
import type { AlertPriority, AssetStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useUi } from "@/stores/ui";
import { areaLabel } from "@/lib/site";

const METHOD_LABEL: Record<AnomalyMethod, string> = {
  residual: "Residual terhadap ekspektasi",
  robust_z: "Z-score robust",
  peer: "Perbandingan aset sekitar",
  stuck_value: "Nilai macet",
  range: "Rentang fisik",
  threshold: "Ambang batas",
};

const DISCLAIMER = "Peluang adalah estimasi model, bukan gangguan yang terkonfirmasi. Pemeriksaan fisik oleh teknisi tetap diperlukan.";

function SignalChart({ id }: { id: string }) {
  const t = useChartTheme();
  const q = useQuery({ queryKey: ["ai", "series", id], queryFn: () => apiGet<AnomalySeries>(`/api/v1/ai/anomalies/${id}`), refetchInterval: 4000 });
  const s = q.data;
  const option = useMemo(() => {
    if (!s || s.points.length === 0) return null;
    const daily = s.kind === "ratio";
    return {
      animation: false,
      tooltip: { ...tooltip(t), formatter: axisTooltip(s.unit, daily ? "date" : "date", 1) },
      legend: { ...legend(t), show: daily },
      grid: grid({ left: 44, top: daily ? 34 : 14 }),
      xAxis: timeAxis(t, "date"),
      yAxis: valueAxis(t, "", {
        min: daily ? 0 : (v: { min: number }) => Math.floor(v.min - 1),
        axisLabel: { color: t.text, fontSize: 11, formatter: `{value}${s.unit === "%" ? "%" : ""}` },
      }),
      series: [
        ...(daily ? [{ name: "Median rumah sekitar", type: "line", showSymbol: false, data: s.points.map((p) => [p.ts * 1000, p.peer ?? null]), lineStyle: { color: t.muted, width: 2, type: "dashed" }, itemStyle: { color: t.muted } }] : []),
        {
          name: daily ? "Aset ini" : s.label,
          type: "line",
          showSymbol: false,
          data: s.points.map((p) => [p.ts * 1000, p.value]),
          lineStyle: { color: t.pv, width: 2.5 },
          itemStyle: { color: t.pv },
          markArea: {
            silent: true,
            itemStyle: { color: t.critical, opacity: 0.1 },
            data: [[{ xAxis: (s.from - (daily ? 43200 : 0)) * 1000 }, { xAxis: (s.to + (daily ? 43200 : 0)) * 1000 }]],
          },
        },
      ],
    };
  }, [s, t]);
  if (q.isLoading) return <Skeleton className="h-52" />;
  if (!option || !s) return null;
  return (
    <div>
      <p className="mb-1 text-xs text-ink-3">{s.label}{s.kind === "ratio" ? ", per hari" : ""}. Area merah adalah jendela anomali.</p>
      <EChart option={option} style={{ height: 210 }} ariaLabel={`${s.label} dengan jendela anomali ditandai`} />
    </div>
  );
}

function assetPath(a: AnomalyDto): string | null {
  if (a.assetType === "pv") return `/solar/${a.assetId}`;
  if (a.assetType === "battery") return `/batteries/${a.assetId}`;
  return null;
}

function DiagnosisCard({ a }: { a: AnomalyDto }) {
  const dx = a.payload.diagnosis;
  const path = assetPath(a);
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-line bg-surface-2 px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <Stethoscope className="h-4 w-4 text-primary" aria-hidden />
          <h2 className="text-sm font-semibold text-ink">Hasil diagnosis AI</h2>
          <span className="ml-auto"><PriorityBadge priority={a.payload.severity as AlertPriority} /></span>
        </div>
        <p className="mt-2 text-lg font-semibold tracking-tight text-ink">
          {path ? <Link href={path} className="num hover:underline">{a.assetId}</Link> : <span className="num">{a.assetId}</span>}: {a.payload.title}
        </p>
        <p className="mt-0.5 text-xs text-ink-3">
          {areaLabel(a.zoneId)}, sejak {dateTime(a.payload.from)}, {a.payload.open ? "masih berlangsung" : "sudah berakhir"}
        </p>
      </div>
      <div className="space-y-5 p-5">
        <SignalChart id={a.id} />
        {dx ? (
          <>
            <section>
              <h3 className="text-xs font-semibold text-ink-2">Kemungkinan penyebab</h3>
              <ul className="mt-2 space-y-3">
                {dx.causes.filter((c) => c.probability >= 0.01).map((c, i) => (
                  <li key={c.key}>
                    <ConfidenceBar label={c.label} probability={c.probability} top={i === 0} />
                    {c.evidence.length > 0 ? (
                      <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-xs text-ink-3">
                        {c.evidence.map((e) => <li key={e}>{e}</li>)}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
            <section className="rounded-xl border border-line bg-surface-2 p-3">
              <h3 className="text-xs font-semibold text-ink-2">Tindakan yang disarankan</h3>
              <p className="mt-1 text-sm text-ink">{dx.causes[0].action}</p>
            </section>
          </>
        ) : (
          <p className="text-sm text-ink-2">Data belum cukup untuk memberi peluang penyebab. Periksa koneksi perangkat di lokasi.</p>
        )}
        <section>
          <h3 className="text-xs font-semibold text-ink-2">Metode deteksi</h3>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {a.payload.methods.map((m) => <li key={m} className="rounded-md bg-surface-2 px-2 py-0.5 text-xs text-ink-2">{METHOD_LABEL[m]}</li>)}
          </ul>
        </section>
        <div className="flex items-start gap-2 rounded-xl bg-st-warning-soft p-3 text-xs text-ink">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-st-warning" aria-hidden />
          <p>{DISCLAIMER}</p>
        </div>
        <p className="num text-[11px] text-ink-3">{a.modelVersion}</p>
      </div>
    </Card>
  );
}

function AnomalyTab() {
  const params = useSearchParams();
  const router = useRouter();
  const zoneId = useUi((s) => s.zoneId);
  const q = useQuery({ queryKey: ["ai", "anomalies"], queryFn: () => apiGet<{ anomalies: AnomalyDto[] }>("/api/v1/ai/anomalies") });
  const list = useMemo(() => (q.data?.anomalies ?? []).filter((a) => !zoneId || a.zoneId === zoneId), [q.data, zoneId]);
  const selectedId = params.get("id");
  const selected = list.find((a) => a.id === selectedId) ?? list[0];

  if (q.isError) return <Card><ErrorState message={(q.error as Error).message} /></Card>;
  if (!q.data) return <Skeleton className="h-96 rounded-2xl" />;
  if (list.length === 0) return <Card><EmptyState title="Tidak ada anomali untuk area ini" hint="Pilih area lain atau tampilkan semua area." /></Card>;

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(320px,2fr)_3fr]">
      <Card className="xl:sticky xl:top-4">
        <CardHeader title={`${list.length} anomali terdeteksi`} description={`${list.filter((a) => a.payload.open).length} masih berlangsung`} action={<ZoneFilter />} />
        <ul className="mt-3 max-h-[calc(100dvh-16rem)] divide-y divide-line overflow-y-auto">
          {list.map((a) => {
            const top = a.payload.diagnosis?.causes[0];
            const active = selected?.id === a.id;
            return (
              <li key={a.id}>
                <button
                  type="button"
                  aria-current={active}
                  onClick={() => router.replace(`/ai?id=${a.id}`, { scroll: false })}
                  className={cn("block w-full border-l-2 px-5 py-3 text-left transition-colors hover:bg-surface-2", active ? "border-primary bg-surface-2" : "border-transparent")}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="num text-sm font-semibold text-ink">{a.assetId}</span>
                    <PriorityBadge priority={a.payload.severity as AlertPriority} />
                  </span>
                  <span className="mt-0.5 block text-sm text-ink-2">{a.payload.title}</span>
                  {top ? <span className="mt-0.5 block text-xs text-ink-3">{top.label}, estimasi {Math.round(top.probability * 100)}%</span> : null}
                  <span className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-3">
                    {a.payload.open ? <span className="live-dot h-1.5 w-1.5 rounded-full bg-st-critical" aria-hidden /> : null}
                    {a.payload.open ? "Berlangsung" : "Berakhir"}, {shortDate(a.payload.from)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </Card>
      {selected ? <DiagnosisCard a={selected} /> : null}
    </div>
  );
}

const col = createColumnHelper<HealthRow>();
const columns = [
  col.accessor("id", { header: "Aset", cell: (c) => <span className="num font-medium">{c.getValue()}</span> }),
  col.accessor("type", { header: "Jenis", cell: (c) => (c.getValue() === "pv" ? "PV" : "Baterai") }),
  col.accessor("zoneId", { header: "Zone", cell: (c) => areaLabel(c.getValue()) }),
  col.accessor((r) => r.score.score, { id: "score", header: "Skor", cell: (c) => <span className="num font-medium">{c.getValue()}</span> }),
  col.accessor((r) => r.score.band, { id: "band", header: "Kategori", cell: (c) => BAND_LABEL[c.getValue()] }),
  col.accessor("status", { header: "Status", cell: (c) => <StatusBadge status={c.getValue() as AssetStatus} /> }),
];

function Histogram({ rows }: { rows: HealthRow[] }) {
  const t = useChartTheme();
  const option = useMemo(() => {
    const labels = ["0–49", "50–69", "70–84", "85–100"];
    const count = (type: "pv" | "battery") => [
      rows.filter((r) => r.type === type && r.score.score < 50).length,
      rows.filter((r) => r.type === type && r.score.score >= 50 && r.score.score < 70).length,
      rows.filter((r) => r.type === type && r.score.score >= 70 && r.score.score < 85).length,
      rows.filter((r) => r.type === type && r.score.score >= 85).length,
    ];
    return {
      animation: false,
      tooltip: { ...tooltip(t), axisPointer: { type: "shadow", shadowStyle: { color: "transparent" } } },
      legend: legend(t),
      grid: grid({ left: 34, bottom: 24 }),
      xAxis: { type: "category", data: labels, axisTick: { show: false }, axisLine: { lineStyle: { color: t.grid } }, axisLabel: { color: t.text, fontSize: 11 } },
      yAxis: { type: "value", minInterval: 1, axisLabel: { color: t.text, fontSize: 11 }, splitLine: { lineStyle: { color: t.grid } } },
      series: [
        { name: "PV", type: "bar", barGap: "12%", data: count("pv"), itemStyle: { color: t.pv, borderRadius: [4, 4, 0, 0] } },
        { name: "Baterai", type: "bar", data: count("battery"), itemStyle: { color: t.battery, borderRadius: [4, 4, 0, 0] } },
      ],
    };
  }, [rows, t]);
  return <EChart option={option} style={{ height: 230 }} ariaLabel="Sebaran skor kesehatan PV dan baterai" />;
}

function HealthTab() {
  const zoneId = useUi((s) => s.zoneId);
  const [type, setType] = useState<"" | "pv" | "battery">("");
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["ai", "health"], queryFn: () => apiGet<{ rows: HealthRow[] }>("/api/v1/ai/health-scores"), refetchInterval: 4000 });
  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (q.data?.rows ?? []).filter((r) => (!zoneId || r.zoneId === zoneId) && (!type || r.type === type) && (!s || r.id.toLowerCase().includes(s)));
  }, [q.data, zoneId, type, search]);
  const worst = useMemo(() => [...rows].sort((a, b) => a.score.score - b.score.score)[0], [rows]);
  const current = rows.find((r) => r.id === picked) ?? worst;

  if (q.isError) return <Card><ErrorState message={(q.error as Error).message} /></Card>;
  if (!q.data) return <Skeleton className="h-96 rounded-2xl" />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input aria-label="Cari aset" placeholder="Cari ID aset" value={search} onChange={(e) => setSearch(e.target.value)} className={inputClass} />
        <ZoneFilter />
        <label htmlFor="type-filter" className="sr-only">Jenis aset</label>
        <select id="type-filter" value={type} onChange={(e) => setType(e.target.value as "" | "pv" | "battery")} className={selectClass}>
          <option value="">PV dan baterai</option>
          <option value="pv">PV</option>
          <option value="battery">Baterai</option>
        </select>
      </div>
      <div className="grid items-start gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card>
            <CardHeader title="Sebaran skor kesehatan" description="Jumlah aset per kategori skor" />
            <div className="px-4 pb-3 pt-2"><Histogram rows={rows} /></div>
          </Card>
          <Card>
            <DataTable data={rows} columns={columns} rowKey={(r) => r.id} pageSize={12} initialSort={[{ id: "score", desc: false }]} onRowClick={(r) => setPicked(r.id)} />
          </Card>
        </div>
        {current ? (
          <Card className="p-5 xl:sticky xl:top-4">
            <p className="num text-lg font-semibold text-ink">{current.id}</p>
            <p className="mb-3 text-xs text-ink-3">{current.type === "pv" ? "Sistem PV" : "Baterai"}, {areaLabel(current.zoneId)}</p>
            <HealthScoreRing score={current.score.score} size={84} />
            <h3 className="mt-4 text-xs font-semibold text-ink-2">Faktor penyusun skor</h3>
            <ul className="mt-2 space-y-2.5">
              {current.score.factors.map((f) => (
                <li key={f.label}>
                  <div className="flex justify-between gap-2 text-xs"><span className="text-ink-2">{f.label}</span><span className="num text-ink">{num(f.points, 1)}/{f.max}</span></div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-primary" style={{ width: `${(f.points / f.max) * 100}%` }} /></div>
                </li>
              ))}
            </ul>
            <DisclaimerNote className="mt-3">Skor adalah estimasi dari bobot tetap dan perlu diverifikasi di lapangan.</DisclaimerNote>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

const tab = "rounded-lg px-3 py-1.5 text-sm font-medium text-ink-2 data-[state=active]:bg-surface data-[state=active]:text-ink data-[state=active]:shadow-sm";

export function AiView() {
  return (
    <div className="space-y-4 p-4 md:p-6">
      <PageTitle title="Diagnosis AI" description="Mesin statistik dan aturan yang dapat dijelaskan. Dari anomali ke kemungkinan penyebab, beserta buktinya." />
      <Tabs.Root defaultValue="anomaly" className="space-y-4">
        <Tabs.List aria-label="Bagian diagnosis" className="inline-flex gap-1 rounded-xl bg-surface-2 p-1">
          <Tabs.Trigger value="anomaly" className={tab}>Anomali dan diagnosis</Tabs.Trigger>
          <Tabs.Trigger value="health" className={tab}>Skor kesehatan</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="anomaly" className="outline-none"><AnomalyTab /></Tabs.Content>
        <Tabs.Content value="health" className="outline-none"><HealthTab /></Tabs.Content>
      </Tabs.Root>
    </div>
  );
}
