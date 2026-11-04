"use client";
import { useQuery } from "@tanstack/react-query";
import { BatteryCharging, CheckCircle2, LogOut, Sun, Wallet } from "lucide-react";
import { signOut } from "next-auth/react";
import { useMemo } from "react";
import { axisTooltip, EChart, grid, timeAxis, tooltip, useChartTheme, valueAxis } from "@/components/charts/echart";
import { LevelBar } from "@/components/domain/health-ring";
import { LogoMark } from "@/components/domain/logo";
import { DisclaimerNote, ErrorState, StatusBadge } from "@/components/domain/status";
import { Button } from "@/components/ui/button";
import { Card, Skeleton } from "@/components/ui/card";
import { apiGet } from "@/lib/client";
import { clockTime, dateTime, num, rupiah } from "@/lib/format";
import type { ResidentDto } from "@/lib/resident-dto";

function TodayChart({ d }: { d: ResidentDto }) {
  const t = useChartTheme();
  const option = useMemo(() => ({
    animation: false,
    tooltip: { ...tooltip(t), formatter: axisTooltip("kW", "clock", 2) },
    grid: grid({ top: 12, left: 36 }),
    xAxis: timeAxis(t),
    yAxis: valueAxis(t, ""),
    series: [{ name: "Daya", type: "line", showSymbol: false, data: d.today.filter((p) => (p.ts + 25200) % 86400 >= 18000).map((p) => [p.ts * 1000, p.w / 1000]), lineStyle: { color: t.pv, width: 2.5 }, itemStyle: { color: t.pv }, areaStyle: { color: t.pv, opacity: 0.14 } }],
  }), [d, t]);
  return <EChart option={option} style={{ height: 180 }} ariaLabel="Produksi rumah hari ini, dalam kW" />;
}

export function ResidentView() {
  const q = useQuery({ queryKey: ["resident"], queryFn: () => apiGet<ResidentDto>("/api/v1/resident"), refetchInterval: 5000 });
  const d = q.data;
  return (
    <div className="mx-auto min-h-dvh max-w-md space-y-3 bg-bg p-4">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <LogoMark />
          <p className="display font-bold tracking-wide text-ink">SUNPULSE</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void signOut({ callbackUrl: "/login" })}><LogOut className="h-3.5 w-3.5" aria-hidden /> Keluar</Button>
      </header>
      {q.isError ? <Card><ErrorState message={(q.error as Error).message} /></Card> : null}
      {!d && !q.isError ? <Skeleton className="h-96 rounded-3xl" /> : null}
      {d ? (
        <>
          <div>
            <h1 className="display text-2xl font-semibold tracking-tight text-ink">Rumah {d.houseId}</h1>
            <p className="text-sm text-ink-3">{d.ownerName}, {d.address}</p>
          </div>
          <Card className="glow-sun p-5">
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-sm text-ink-2"><Sun className="h-4 w-4 text-sun" aria-hidden /> Daya surya pukul {clockTime(d.simTs)} WIB</p>
              <StatusBadge status={d.status} />
            </div>
            <p className="mt-1 flex items-baseline gap-1.5"><span className="display text-5xl font-semibold tracking-tight text-ink">{num(d.acW / 1000, 2)}</span><span className="text-sm text-ink-3">kW dari {num(d.capacityKwp, 2)} kWp</span></p>
            <div className="mt-3"><TodayChart d={d} /></div>
          </Card>
          <div className="grid grid-cols-2 gap-3">
            <Card className="p-4">
              <p className="text-xs text-ink-3">Produksi hari ini</p>
              <p className="mt-1"><span className="display text-2xl font-semibold text-ink">{num(d.todayKwh, 1)}</span> <span className="text-xs text-ink-3">kWh</span></p>
            </Card>
            <Card className="p-4">
              <p className="flex items-center gap-1 text-xs text-ink-3"><Wallet className="h-3 w-3" aria-hidden /> Estimasi hemat</p>
              <p className="display mt-1 text-2xl font-semibold text-ink">{rupiah(d.savingsRp)}</p>
            </Card>
          </div>
          <Card className="glow-battery p-5">
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-sm text-ink-2"><BatteryCharging className="h-4 w-4 text-primary" aria-hidden /> Baterai bersama <span className="num">{d.battery.id}</span></p>
              <StatusBadge status={d.battery.status} />
            </div>
            <p className="display mt-1 text-3xl font-semibold text-ink">{num(d.battery.soc, 0)}%</p>
            <div className="mt-2"><LevelBar value={d.battery.soc} label="Tingkat isi baterai" className="bg-st-normal" /></div>
            <p className="mt-2 text-xs text-ink-3">{d.battery.charging ? "Sedang mengisi dari surya" : d.battery.discharging ? "Sedang memasok rumah" : "Diam"}</p>
          </Card>
          <Card className="p-5">
            <h2 className="display text-[15px] font-semibold text-ink">Masalah pada rumah Anda</h2>
            {d.issues.length === 0 ? (
              <p className="mt-2 flex items-center gap-1.5 text-sm text-ink-2"><CheckCircle2 className="h-4 w-4 text-st-normal" aria-hidden /> Tidak ada masalah terbuka.</p>
            ) : (
              <ul className="mt-2 space-y-3">
                {d.issues.map((i) => (
                  <li key={i.id}>
                    <p className="text-sm text-ink">{i.message}</p>
                    <p className="text-xs text-ink-3">{dateTime(i.createdAt)}. Tim pengelola: {i.recommendedAction}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <DisclaimerNote>Data simulasi. Estimasi hemat memakai tarif {rupiah(d.tariffRp)}/kWh, tanpa kredit ekspor.</DisclaimerNote>
        </>
      ) : null}
    </div>
  );
}
