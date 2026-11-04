"use client";
import { Bell, Clock, Lock } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { clockTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useLive } from "@/stores/live";
import { PulseLine } from "@/components/domain/pulse-score";

export function TopbarLive() {
  const snapshot = useLive((s) => s.snapshot);
  const connected = useLive((s) => s.connected);
  const lastUpdate = useLive((s) => s.lastUpdate);
  const [now, setNow] = useState(0);

  useEffect(() => {
    const update = () => setNow(Date.now());
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);

  const age = lastUpdate && now ? Math.max(0, Math.round((now - lastUpdate) / 1000)) : null;
  const live = connected && snapshot?.simulatorConnected && age !== null && age < 10;
  const locked = snapshot?.clock.mode === "locked";

  return (
    <>
      {snapshot ? (
        <div className="hidden items-center gap-1.5 rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs text-ink-2 md:flex" title={locked ? "Waktu simulasi dikunci untuk demo" : "Waktu simulasi mengikuti jam sebenarnya"}>
          {locked ? <Lock className="h-3 w-3 text-sun" aria-hidden /> : <Clock className="h-3 w-3" aria-hidden />}
          <span>Waktu simulasi</span>
          <span className="num font-medium text-ink">{clockTime(snapshot.simTs)} WIB</span>
        </div>
      ) : null}
      <div className="hidden items-center gap-1.5 px-1.5 text-xs text-ink-2 sm:flex" role="status">
        {live ? <PulseLine bpm={72} color="#10B981" className="h-5 w-12" /> : <span className={cn("h-2 w-2 rounded-full bg-st-offline")} aria-hidden />}
        {live ? <span>Langsung, {age} dtk lalu</span> : <span>{snapshot && connected ? "Simulator tidak berjalan" : "Menyambungkan"}</span>}
      </div>
      <Link href="/alerts" className="relative flex h-9 w-9 items-center justify-center rounded-lg text-ink-2 hover:bg-surface-2" aria-label={`Alert terbuka: ${snapshot?.openAlerts ?? 0}`}>
        <Bell className="h-4 w-4" aria-hidden />
        {snapshot && snapshot.openAlerts > 0 ? (
          <span className="num absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-st-critical px-1 text-[10px] font-semibold text-white dark:text-[#2a0a0a]">
            {snapshot.openAlerts}
          </span>
        ) : null}
      </Link>
    </>
  );
}

export function StaleBanner() {
  const stale = useLive((s) => s.snapshot?.seedStale);
  if (!stale) return null;
  return (
    <p role="alert" className="bg-st-warning-soft px-4 py-1.5 text-center text-xs text-ink">
      Data simulasi berasal dari hari lain, sehingga grafik hari ini kosong. Hentikan aplikasi lalu jalankan npm run demo untuk menyusunnya ulang.
    </p>
  );
}
