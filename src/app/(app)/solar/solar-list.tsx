"use client";
import { createColumnHelper } from "@tanstack/react-table";
import { Download } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { EChart, grid, tooltip, useChartTheme } from "@/components/charts/echart";
import { GangFilter, inputClass, StatusFilter } from "@/components/domain/asset-parts";
import { DataTable } from "@/components/domain/data-table";
import { DisclaimerNote, PageTitle, StatusBadge } from "@/components/domain/status";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, Skeleton } from "@/components/ui/card";
import { median } from "@/lib/ai/stats";
import { num } from "@/lib/format";
import type { PvLive } from "@/lib/live/store";
import type { AssetStatus } from "@/lib/types";
import { useLive } from "@/stores/live";
import { useUi } from "@/stores/ui";

const specificYield = (p: PvLive) => p.todayKwh / p.capacityKwp;

const col = createColumnHelper<PvLive>();
const columns = [
  col.accessor("id", { header: "ID", cell: (c) => <span className="num font-medium">{c.getValue()}</span> }),
  col.accessor("gangId", { header: "Gang", cell: (c) => c.getValue().replace("G", "Gang ") }),
  col.accessor("capacityKwp", { header: "Kapasitas", cell: (c) => <span className="num">{num(c.getValue(), 2)} kWp</span> }),
  col.accessor("acW", { header: "Daya kini", cell: (c) => <span className="num">{num(c.getValue() / 1000, 2)} kW</span> }),
  col.accessor("todayKwh", { header: "Hari ini", cell: (c) => <span className="num">{num(c.getValue(), 1)} kWh</span> }),
  col.accessor("ratio", { header: "Thd. ekspektasi", cell: (c) => <span className="num">{num(c.getValue() * 100, 0)}%</span> }),
  col.accessor(specificYield, { id: "yield", header: "Yield spesifik", cell: (c) => <span className="num">{num(c.getValue(), 2)} kWh/kWp</span> }),
  col.accessor("health", { header: "Skor", cell: (c) => <span className="num">{c.getValue()}</span> }),
  col.accessor("status", { header: "Status", cell: (c) => <StatusBadge status={c.getValue()} /> }),
];

function YieldRanking({ list }: { list: PvLive[] }) {
  const t = useChartTheme();
  const option = useMemo(() => {
    const medians = new Map<string, number>();
    for (const g of new Set(list.map((p) => p.gangId))) medians.set(g, median(list.filter((p) => p.gangId === g).map(specificYield)));
    const sorted = [...list].sort((a, b) => specificYield(b) - specificYield(a));
    const low = (p: PvLive) => specificYield(p) < 0.8 * (medians.get(p.gangId) ?? 0);
    return {
      animation: false,
      tooltip: { ...tooltip(t), axisPointer: { type: "shadow", shadowStyle: { color: "transparent" } }, formatter: (p: { name: string; value: number }[]) => `${p[0].name}<br/><b>${num(p[0].value, 2)} kWh/kWp</b>` },
      grid: grid({ top: 12, left: 36, bottom: 26 }),
      xAxis: { type: "category", data: sorted.map((p) => p.id), axisTick: { show: false }, axisLine: { lineStyle: { color: t.grid } }, axisLabel: { color: t.text, fontSize: 10, interval: list.length > 40 ? 9 : 0 } },
      yAxis: { type: "value", axisLabel: { color: t.text, fontSize: 11 }, splitLine: { lineStyle: { color: t.grid } } },
      series: [{ type: "bar", barCategoryGap: "20%", data: sorted.map((p) => ({ value: specificYield(p), itemStyle: { color: low(p) ? t.critical : t.pv, borderRadius: [2, 2, 0, 0] } })) }],
    };
  }, [list, t]);
  return <EChart option={option} style={{ height: 200 }} ariaLabel="Peringkat rumah menurut yield spesifik hari ini" />;
}

function exportCsv(rows: PvLive[]) {
  const head = "id,gang,kapasitas_kwp,daya_kw,hari_ini_kwh,terhadap_ekspektasi_persen,yield_kwh_per_kwp,skor,status";
  const body = rows.map((p) => [p.id, p.gangId, p.capacityKwp, (p.acW / 1000).toFixed(3), p.todayKwh.toFixed(2), (p.ratio * 100).toFixed(0), specificYield(p).toFixed(3), p.health, p.status].join(","));
  const url = URL.createObjectURL(new Blob([[head, ...body].join("\n")], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "doctor-pv-rumah-surya.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export function SolarList() {
  const router = useRouter();
  const pv = useLive((s) => s.snapshot?.pv);
  const gangId = useUi((s) => s.gangId);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<AssetStatus | "">("");
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (pv ?? []).filter((p) => (!gangId || p.gangId === gangId) && (!status || p.status === status) && (!q || p.id.toLowerCase().includes(q)));
  }, [pv, gangId, status, search]);

  return (
    <div className="space-y-4 p-4 md:p-6">
      <PageTitle title="Rumah dan surya" description="100 instalasi PV atap, satu per rumah." action={<Button onClick={() => exportCsv(filtered)} disabled={filtered.length === 0}><Download className="h-4 w-4" aria-hidden /> Unduh CSV</Button>} />
      <div className="flex flex-wrap items-center gap-2">
        <input aria-label="Cari ID rumah" placeholder="Cari ID, misalnya H021" value={search} onChange={(e) => setSearch(e.target.value)} className={inputClass} />
        <GangFilter />
        <StatusFilter value={status} onChange={setStatus} />
      </div>
      {!pv ? <Skeleton className="h-72 rounded-2xl" /> : (
        <>
          <Card>
            <CardHeader title="Peringkat yield spesifik hari ini" description="Merah berarti di bawah 80% median gangnya, sehingga perbedaan cuaca dan kapasitas tidak memengaruhi." />
            <div className="px-4 pb-2 pt-2"><YieldRanking list={filtered} /></div>
          </Card>
          <Card><DataTable data={filtered} columns={columns} rowKey={(p) => p.id} onRowClick={(p) => router.push(`/solar/${p.id}`)} initialSort={[{ id: "health", desc: false }]} /></Card>
        </>
      )}
      <DisclaimerNote>Data simulasi. Ekspektasi dihitung dari iradiasi, suhu, dan performance ratio historis tiap sistem.</DisclaimerNote>
    </div>
  );
}
