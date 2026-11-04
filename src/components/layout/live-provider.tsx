"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { toast } from "sonner";
import type { AlertEvent, LiveSnapshot } from "@/lib/live/store";
import { useLive } from "@/stores/live";

/** Holds the single SSE connection, feeds the live store, and turns alert events into toasts. */
export function LiveProvider() {
  const qc = useQueryClient();
  const setSnapshot = useLive((s) => s.setSnapshot);
  const setConnected = useLive((s) => s.setConnected);

  useEffect(() => {
    const source = new EventSource("/api/v1/stream");
    source.addEventListener("snapshot", (e) => setSnapshot(JSON.parse((e as MessageEvent<string>).data) as LiveSnapshot));
    source.addEventListener("alert", (e) => {
      const ev = JSON.parse((e as MessageEvent<string>).data) as AlertEvent;
      void qc.invalidateQueries({ queryKey: ["alerts"] });
      void qc.invalidateQueries({ queryKey: ["ai"] });
      void qc.invalidateQueries({ queryKey: ["overview"] });
      if (ev.kind === "new" || ev.kind === "upgraded") {
        const title = ev.message ?? "Alert baru";
        const opts = { description: ev.recommendedAction, duration: 8000 };
        void qc.invalidateQueries({ queryKey: ["work-orders"] });
        if (ev.priority === "critical") toast.error(title, opts);
        else if (ev.priority === "high") toast.warning(title, opts);
        else if (ev.priority === "medium") toast.warning(title, opts);
        else toast.info(title, opts);
      } else if (ev.kind === "sync") {
        toast.success(ev.message ?? "Data tersinkron");
      } else if (ev.kind === "reset") {
        toast.info("Sistem kembali ke kondisi awal demo.");
      }
    });
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    return () => source.close();
  }, [qc, setSnapshot, setConnected]);

  return null;
}
