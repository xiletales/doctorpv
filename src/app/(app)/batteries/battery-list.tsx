"use client";
import { createColumnHelper } from "@tanstack/react-table";
import { LayoutGrid, Rows3 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { EChart, grid, tooltip, useChartTheme } from "@/components/charts/echart";
import { GangFilter, inputClass, StatusFilter } from "@/components/domain/asset-parts";
import { DataTable } from "@/components/domain/data-table";
import { DisclaimerNote, PageTitle, StatusBadge } from "@/components/domain/status";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, Skeleton } from "@/components/ui/card";
import { num } from "@/lib/format";
import type { BatteryLive } from "@/lib/live/store";
import type { AssetStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useLive } from "@/stores/live";
import { useUi } from "@/stores/ui";

const col = createColumnHelper<BatteryLive>();
const columns = [
  col.accessor("id", { header: "ID", cell: (c) => <span className="num font-medium">{c.getValue()}</span> }),
  col.accessor("gangId", { header: "Gang", cell: (c) => c.getValue().replace("G", "Gang ") }),
  col.accessor("soc", { header: "SoC", cell: (c) => <span className="num">{num(c.getValue(), 1)}%</span> }),
  col.accessor("soh", { header: "SoH", cell: (c) => <span className="num">{num(c.getValue(), 1)}%</span> }),
  col.accessor("voltage", { header: "Tegangan", cell: (c) => <span className="num">{num(c.getValue(), 1)} V</span> }),
  col.accessor("currentA", { header: "Arus", cell: (c) => <span className="num">{num(c.getValue(), 1)} A</span> }),
  col.accessor("tempC", { header: "Suhu", cell: (c) => <span className="num">{num(c.getValue(), 1)} °C</span> }),
  col.accessor("cycles", { header: "Siklus", cell: (c) => <span className="num">{num(c.getValue(), 0)}</span> }),
  col.accessor("bms", { header: "BMS" }),
  col.accessor("health", { header: "Skor", cell: (c) => <span className="num">{c.getValue()}</span> }),
  col.accessor("status", { header: "Status", cell: (c) => <StatusBadge status={c.getValue()} /> }),
];

const FILL: Record<AssetStatus, string> = { normal: "bg-st-normal", warning: "bg-st-warning", critical: "bg-st-critical", offline: "bg-st-offline", maintenance: "bg-st-maintenance" };

function BatteryCell({ b }: { b: BatteryLive }) {
  const charging = b.currentA > 0.5;
  return (
    <Link href={`/batteries/${b.id}`} className="group flex gap-3 rounded-2xl border border-line bg-surface p-3 transition-colors hover:border-ink-3">
      <div className="relative h-20 w-11 shrink-0 overflow-hidden rounded-lg border-2 border-line bg-surface-2" aria-hidden>
        <div className={cn("absolute inset-x-0 bottom-0 transition-[height] duration-700", FILL[b.status])} style={{ height: `${b.soc}%` }} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-1">
          <p className="num text-sm font-semibold text-ink">{b.id}</p>
        </div>
        <p className="num mt-0.5 text-lg font-semibold leading-tight text-ink">{num(b.soc, 0)}%</p>
        <p className="text-xs text-ink-3">{charging ? "Mengisi" : b.currentA < -0.5 ? "Mengosongkan" : "Diam"}</p>
        <StatusBadge status={b.status} className="mt-1.5" />
      </div>
      <dl className="hidden shrink-0 space-y-0.5 text-right text-xs sm:block">
        <div><dt className="sr-only">SoH</dt><dd className="num text-ink">{num(b.soh, 1)}%</dd><span className="text-ink-3">SoH</span></div>
        <div><dt className="sr-only">Suhu</dt><dd className="num text-ink">{num(b.tempC, 1)} °C</dd></div>
      </dl>
    </Link>
  );
}

function SohCompare({ list, gangLabel }: { list: BatteryLive[]; gangLabel: string }) {
  const t = useChartTheme();
  const option = useMemo(() => {
    const sorted = [...list].sort((a, b) => a.id.localeCompare(b.id));
    return {
      animation: false,
      tooltip: { ...tooltip(t), axisPointer: { type: "shadow", shadowStyle: { color: "transparent" } }, formatter: (p: { name: string; value: number }[]) => `${p[0].name}<br/><b>SoH ${num(p[0].value, 1)}%</b>` },
      grid: grid({ top: 14, left: 34, bottom: 24 }),
      xAxis: { type: "category", data: sorted.map((b) => b.id), axisLabel: { color: t.text, fontSize: 11 }, axisTick: { show: false }, axisLine: { lineStyle: { color: t.grid } } },
      yAxis: { type: "value", min: 60, max: 100, axisLabel: { color: t.text, fontSize: 11, formatter: "{value}%" }, splitLine: { lineStyle: { color: t.grid } } },
      series: [{
        type: "bar", barWidth: "55%",
        data: sorted.map((b) => ({ value: b.soh, itemStyle: { color: b.soh < 80 ? t.high : t.battery, borderRadius: [4, 4, 0, 0] } })),
        markLine: { silent: true, symbol: "none", label: { formatter: "Ambang 80%", color: t.text, fontSize: 11, position: "insideStartTop" }, lineStyle: { color: t.muted, type: "dashed" }, data: [{ yAxis: 80 }] },
      }],
    };
  }, [list, t]);
  return <EChart option={option} style={{ height: 220 }} ariaLabel={`Perbandingan SoH baterai ${gangLabel}`} />;
}

export function BatteryList() {
  const router = useRouter();
  const batteries = useLive((s) => s.snapshot?.batteries);
  const gangId = useUi((s) => s.gangId);
  const [view, setView] = useState<"grid" | "table">("grid");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<AssetStatus | "">("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (batteries ?? []).filter((b) => (!gangId || b.gangId === gangId) && (!status || b.status === status) && (!q || b.id.toLowerCase().includes(q)));
  }, [batteries, gangId, status, search]);

  const compare = useMemo(() => {
    const g = gangId ?? batteries?.[0]?.gangId;
    return (batteries ?? []).filter((b) => b.gangId === g);
  }, [batteries, gangId]);

  return (
    <div className="space-y-4 p-4 md:p-6">
      <PageTitle title="Kesehatan baterai" description="50 baterai LiFePO₄ bersama, 10 unit per gang." />
      <div className="flex flex-wrap items-center gap-2">
        <input aria-label="Cari ID baterai" placeholder="Cari ID, misalnya B025" value={search} onChange={(e) => setSearch(e.target.value)} className={inputClass} />
        <GangFilter />
        <StatusFilter value={status} onChange={setStatus} />
        <div className="ml-auto flex gap-1 rounded-lg border border-line bg-surface p-0.5">
          <Button size="sm" variant={view === "grid" ? "primary" : "ghost"} aria-pressed={view === "grid"} onClick={() => setView("grid")}><LayoutGrid className="h-3.5 w-3.5" aria-hidden /> Kartu</Button>
          <Button size="sm" variant={view === "table" ? "primary" : "ghost"} aria-pressed={view === "table"} onClick={() => setView("table")}><Rows3 className="h-3.5 w-3.5" aria-hidden /> Tabel</Button>
        </div>
      </div>

      {!batteries ? <Skeleton className="h-72 rounded-2xl" /> : view === "grid" ? (
        filtered.length === 0 ? (
          <Card className="px-6 py-10 text-center text-sm text-ink-3">Tidak ada baterai yang cocok. Ubah filter untuk melihat lebih banyak.</Card>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">{filtered.map((b) => <BatteryCell key={b.id} b={b} />)}</div>
        )
      ) : (
        <Card><DataTable data={filtered} columns={columns} rowKey={(b) => b.id} onRowClick={(b) => router.push(`/batteries/${b.id}`)} initialSort={[{ id: "health", desc: false }]} /></Card>
      )}

      {compare.length > 0 ? (
        <Card>
          <CardHeader title={`Perbandingan SoH ${(gangId ?? compare[0].gangId).replace("G", "Gang ")}`} description="Pilih gang pada filter untuk membandingkan gang lain" />
          <div className="px-4 pb-3 pt-2"><SohCompare list={compare} gangLabel={(gangId ?? compare[0].gangId).replace("G", "Gang ")} /></div>
        </Card>
      ) : null}
      <DisclaimerNote>SoH diperoleh dari BMS bila didukung, atau diestimasi dengan metode tervalidasi. SoH tidak diukur langsung oleh sensor sederhana. Data simulasi.</DisclaimerNote>
    </div>
  );
}
