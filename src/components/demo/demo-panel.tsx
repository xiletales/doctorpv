"use client";
import { useMutation } from "@tanstack/react-query";
import { BatteryWarning, Clock, CloudRain, FastForward, Lock, Plug, PlugZap, RotateCcw, ServerCrash, ZapOff, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { ScenarioName } from "@/lib/contracts/telemetry";
import { apiSend } from "@/lib/client";
import { clockTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useLive } from "@/stores/live";

function Scenario({ icon: Icon, title, effect, active, disabled, onRun, runLabel, links }: { icon: LucideIcon; title: string; effect: string; active: boolean; disabled: boolean; onRun: () => void; runLabel: string; links: { href: string; label: string }[] }) {
  return (
    <div className={cn("rounded-xl border p-3", active ? "border-st-critical bg-st-critical-soft" : "border-line bg-surface")}>
      <div className="flex items-start gap-3">
        <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", active ? "text-st-critical" : "text-ink-3")} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">{title}</p>
          <p className="mt-0.5 text-xs text-ink-2">{effect}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <Button size="sm" variant={active ? "secondary" : "primary"} disabled={disabled || active} onClick={onRun}>{active ? "Sedang aktif" : runLabel}</Button>
            {links.map((l) => <Link key={l.href} href={l.href} className="text-xs font-medium text-primary hover:underline">{l.label}</Link>)}
          </div>
        </div>
      </div>
    </div>
  );
}

export function DemoPanel({ onNavigate }: { onNavigate?: () => void }) {
  const snapshot = useLive((s) => s.snapshot);
  const d = snapshot?.directive;
  const run = useMutation({
    mutationFn: (name: ScenarioName) => apiSend(`/api/v1/demo/scenarios/${name}`, "POST"),
    onError: (e: Error) => toast.error(e.message),
  });
  const clock = useMutation({
    mutationFn: (mode: "locked" | "real") => apiSend("/api/v1/demo/clock", "POST", { mode }),
    onError: (e: Error) => toast.error(e.message),
  });
  const disabled = run.isPending || !d;
  const locked = snapshot?.clock.mode === "locked";

  return (
    <div className="space-y-3" onClickCapture={(e) => { if ((e.target as HTMLElement).closest("a")) onNavigate?.(); }}>
      {snapshot && !snapshot.simulatorConnected ? (
        <p role="alert" className="flex items-start gap-2 rounded-xl bg-st-warning-soft p-3 text-sm text-ink">
          <ServerCrash className="mt-0.5 h-4 w-4 shrink-0 text-st-warning" aria-hidden />
          Simulator tidak berjalan, jadi skenario belum berefek. Jalankan npm run simulate di terminal kedua.
        </p>
      ) : null}

      <Scenario icon={ZapOff} title="Gangguan inverter di H21" effect="Output nol pada iradiasi tinggi. Marker memerah dan Pulse Score turun dalam beberapa detik." active={Boolean(d?.inverterH21)} disabled={disabled} onRun={() => run.mutate("inverter_h21")} runLabel="Picu gangguan" links={[{ href: "/map?asset=H21", label: "Peta" }, { href: "/solar/H21", label: "Detail" }, { href: "/ai", label: "Diagnosis" }]} />
      <Scenario icon={BatteryWarning} title="Baterai B08 kepanasan" effect="Suhu naik tiap tick. Alert Tinggi di 45 °C, naik menjadi Kritis di 55 °C." active={Boolean(d?.batteryB08)} disabled={disabled} onRun={() => run.mutate("battery_b08_overheat")} runLabel="Picu kepanasan" links={[{ href: "/map?asset=B08", label: "Peta" }, { href: "/batteries/B08", label: "Detail" }, { href: "/ai", label: "Diagnosis" }]} />

      <div className={cn("rounded-xl border p-3", d?.gw3Offline ? "border-st-offline bg-st-offline-soft" : "border-line bg-surface")}>
        <div className="flex items-start gap-3">
          {d?.gw3Offline ? <Plug className="mt-0.5 h-5 w-5 shrink-0 text-st-offline" aria-hidden /> : <PlugZap className="mt-0.5 h-5 w-5 shrink-0 text-ink-3" aria-hidden />}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink">Gateway GW-3 terputus</p>
            <p className="mt-0.5 text-xs text-ink-2">Aset Zona C menjadi Offline, sedangkan zona lain tetap langsung. Data ditampung di buffer. Saat tersambung kembali, buffer tersinkron sekaligus.</p>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
              {d?.gw3Offline ? (
                <Button size="sm" variant="primary" disabled={disabled} onClick={() => run.mutate("gateway_gw3_reconnect")}>Sambungkan dan sinkronkan</Button>
              ) : (
                <Button size="sm" variant="primary" disabled={disabled} onClick={() => run.mutate("gateway_gw3_offline")}>Putuskan GW-3</Button>
              )}
              <Link href="/map" className="text-xs font-medium text-primary hover:underline">Peta</Link>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Button variant={d?.cloudy ? "primary" : "secondary"} aria-pressed={Boolean(d?.cloudy)} disabled={disabled} onClick={() => run.mutate("cloudy_day")}><CloudRain className="h-4 w-4" aria-hidden /> {d?.cloudy ? "Kembalikan cerah" : "Hari berawan"}</Button>
        <Button variant={d?.fastForward ? "primary" : "secondary"} aria-pressed={Boolean(d?.fastForward)} disabled={disabled} onClick={() => run.mutate("fast_forward_30d")}><FastForward className="h-4 w-4" aria-hidden /> {d?.fastForward ? "Batalkan percepatan" : "Percepat degradasi 30 hari"}</Button>
      </div>

      <Button className="w-full" variant="secondary" disabled={disabled} onClick={() => run.mutate("reset", { onSuccess: () => toast.dismiss() })}>
        <RotateCcw className="h-4 w-4" aria-hidden /> Kembalikan ke kondisi awal
      </Button>

      <div className="rounded-xl border border-line bg-surface p-3">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          {locked ? <Lock className="h-4 w-4 text-sun" aria-hidden /> : <Clock className="h-4 w-4 text-ink-3" aria-hidden />}
          Waktu simulasi{snapshot ? <span className="num font-medium">{clockTime(snapshot.simTs)} WIB</span> : null}
        </p>
        <p className="mt-0.5 text-xs text-ink-2">{locked ? "Dikunci agar produksi surya tetap terlihat, kapan pun presentasi berlangsung." : "Mengikuti jam sebenarnya. Pada malam hari produksi surya nol."}</p>
        <div className="mt-2 flex gap-2">
          <Button size="sm" variant={locked ? "primary" : "secondary"} aria-pressed={locked} disabled={clock.isPending} onClick={() => clock.mutate("locked")}>Kunci 10.15 WIB</Button>
          <Button size="sm" variant={!locked ? "primary" : "secondary"} aria-pressed={!locked} disabled={clock.isPending} onClick={() => clock.mutate("real")}>Jam sebenarnya</Button>
        </div>
      </div>
    </div>
  );
}
