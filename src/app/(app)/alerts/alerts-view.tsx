"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CheckCheck, ChevronDown, ClipboardPlus, Hammer } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { GangFilter, inputClass, selectClass } from "@/components/domain/asset-parts";
import { useSessionUser } from "@/components/layout/session-context";
import { can } from "@/lib/rbac";
import { DisclaimerNote, EmptyState, ErrorState, PageTitle, PriorityBadge } from "@/components/domain/status";
import { ConfidenceBar } from "@/components/domain/confidence-bar";
import { Button } from "@/components/ui/button";
import { Card, Skeleton } from "@/components/ui/card";
import type { AlertDto } from "@/lib/alerts/dto";
import { ALERT_TYPE_LABEL } from "@/lib/alerts/rules";
import { apiGet, apiSend } from "@/lib/client";
import { dateTime, num } from "@/lib/format";
import { ALERT_STATUS_LABEL, type AlertPriority, type AlertStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useUi } from "@/stores/ui";

function assetHref(a: AlertDto): string | null {
  if (a.assetType === "pv") return `/solar/${a.assetId}`;
  if (a.assetType === "battery") return `/batteries/${a.assetId}`;
  return null;
}

function minutes(sec: number): string {
  if (sec < 3600) return `${num(sec / 60, 0)} mnt`;
  return `${num(sec / 3600, 1)} jam`;
}

function Stats({ alerts }: { alerts: AlertDto[] }) {
  const stats = useMemo(() => {
    const active = alerts.filter((a) => a.status !== "resolved");
    const count = (p: AlertPriority) => active.filter((a) => a.priority === p).length;
    const acked = alerts.filter((a) => a.acknowledgedAt && a.acknowledgedAt >= a.createdAt);
    const resolved = alerts.filter((a) => a.resolvedAt && a.resolvedAt >= a.createdAt);
    const avg = (v: number[]) => (v.length ? v.reduce((x, y) => x + y, 0) / v.length : null);
    return {
      critical: count("critical"),
      high: count("high"),
      medium: count("medium"),
      low: count("low"),
      mtta: avg(acked.map((a) => (a.acknowledgedAt ?? 0) - a.createdAt)),
      mttr: avg(resolved.map((a) => (a.resolvedAt ?? 0) - a.createdAt)),
    };
  }, [alerts]);
  const tile = (label: string, value: string, tone?: string) => (
    <div className="min-w-0 px-4 py-3">
      <p className="truncate text-xs text-ink-3">{label}</p>
      <p className={cn("num mt-1 text-xl font-semibold tracking-tight text-ink", tone)}>{value}</p>
    </div>
  );
  return (
    <Card className="grid grid-cols-2 divide-line sm:grid-cols-3 lg:grid-cols-6 [&>*]:border-b [&>*]:border-line lg:[&>*]:border-b-0">
      {tile("Kritis terbuka", String(stats.critical), stats.critical > 0 ? "text-st-critical" : undefined)}
      {tile("Tinggi terbuka", String(stats.high))}
      {tile("Sedang terbuka", String(stats.medium))}
      {tile("Rendah terbuka", String(stats.low))}
      {tile("Rata-rata waktu respons", stats.mtta === null ? "–" : minutes(stats.mtta))}
      {tile("Rata-rata waktu selesai", stats.mttr === null ? "–" : minutes(stats.mttr))}
    </Card>
  );
}

function CreateOrder({ a }: { a: AlertDto }) {
  const user = useSessionUser();
  const qc = useQueryClient();
  const create = useMutation({
    mutationFn: () => apiSend("/api/v1/work-orders", "POST", { alertId: a.id }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["alerts"] });
      void qc.invalidateQueries({ queryKey: ["work-orders"] });
      toast.success(`Perintah kerja untuk ${a.assetId} dibuat.`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (a.workOrderId) return <Link href="/maintenance" className="inline-flex h-8 items-center text-xs font-medium text-primary hover:underline">Lihat perintah kerja</Link>;
  if (!can(user.role, "workorders:create") || a.assetType === "gateway") return null;
  return <Button size="sm" disabled={create.isPending} onClick={() => create.mutate()}><ClipboardPlus className="h-3.5 w-3.5" aria-hidden /> Buat perintah kerja</Button>;
}

function AlertRow({ a, onChange, busy }: { a: AlertDto; onChange: (id: string, status: "acknowledged" | "in_progress" | "resolved") => void; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const href = assetHref(a);
  const stripe: Record<AlertPriority, string> = { critical: "bg-st-critical", high: "bg-st-warning", medium: "bg-st-warning", low: "bg-st-offline" };
  return (
    <li className={cn("relative", a.status === "resolved" && "opacity-70")}>
      <span className={cn("absolute inset-y-0 left-0 w-1", stripe[a.priority])} aria-hidden />
      <div className="grid gap-2 py-3 pl-5 pr-4 md:grid-cols-[1fr_auto] md:items-center">
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="min-w-0 text-left">
          <span className="flex flex-wrap items-center gap-2">
            <PriorityBadge priority={a.priority} />
            <span className="num text-sm font-semibold text-ink">{a.assetId}</span>
            <span className="text-xs text-ink-3">{ALERT_TYPE_LABEL[a.type]}, {a.gangId.replace("G", "Gang ")}</span>
          </span>
          <span className="mt-1 flex items-start gap-1 text-sm text-ink">
            {a.message}
            <ChevronDown className={cn("mt-0.5 h-4 w-4 shrink-0 text-ink-3 transition-transform", open && "rotate-180")} aria-hidden />
          </span>
          <span className="mt-0.5 block text-xs text-ink-3">
            {dateTime(a.createdAt)}, {ALERT_STATUS_LABEL[a.status].toLowerCase()}{a.acknowledgedBy ? ` oleh ${a.acknowledgedBy}` : ""}
          </span>
        </button>
        {a.status !== "resolved" ? (
          <div className="flex flex-wrap items-center gap-1.5 md:justify-end">
            <CreateOrder a={a} />
            {a.status === "open" ? <Button size="sm" disabled={busy} onClick={() => onChange(a.id, "acknowledged")}><Check className="h-3.5 w-3.5" aria-hidden /> Terima</Button> : null}
            {a.status !== "in_progress" ? <Button size="sm" disabled={busy} onClick={() => onChange(a.id, "in_progress")}><Hammer className="h-3.5 w-3.5" aria-hidden /> Tangani</Button> : null}
            <Button size="sm" variant="primary" disabled={busy} onClick={() => onChange(a.id, "resolved")}><CheckCheck className="h-3.5 w-3.5" aria-hidden /> Selesaikan</Button>
          </div>
        ) : null}
      </div>
      {open ? (
        <div className="grid gap-4 border-t border-line bg-surface-2 py-4 pl-5 pr-4 md:grid-cols-2">
          <div>
            <h3 className="text-xs font-semibold text-ink-2">Tindakan yang disarankan</h3>
            <p className="mt-1 text-sm text-ink">{a.recommendedAction}</p>
            <div className="mt-3 flex flex-wrap gap-3 text-sm">
              {href ? <Link href={href} className="font-medium text-primary hover:underline">Buka detail aset</Link> : null}
              {a.assetType !== "gateway" ? <Link href={`/map?asset=${a.assetId}`} className="font-medium text-primary hover:underline">Lihat di peta</Link> : null}
              <Link href="/ai" className="font-medium text-primary hover:underline">Buka diagnosis AI</Link>
            </div>
          </div>
          {a.diagnosis ? (
            <div>
              <h3 className="text-xs font-semibold text-ink-2">Estimasi penyebab</h3>
              <ul className="mt-2 space-y-2">
                {a.diagnosis.causes.slice(0, 3).map((c, i) => <li key={c.key}><ConfidenceBar label={c.label} probability={c.probability} top={i === 0} /></li>)}
              </ul>
              <DisclaimerNote className="mt-2">Estimasi model, perlu verifikasi teknisi.</DisclaimerNote>
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export function AlertsView() {
  const gangId = useUi((s) => s.gangId);
  const qc = useQueryClient();
  const [priority, setPriority] = useState<AlertPriority | "">("");
  const [status, setStatus] = useState<"active" | AlertStatus | "">("active");
  const [search, setSearch] = useState("");

  const q = useQuery({ queryKey: ["alerts", "all"], queryFn: () => apiGet<{ alerts: AlertDto[] }>("/api/v1/alerts?limit=300") });
  const mutate = useMutation({
    mutationFn: ({ id, next }: { id: string; next: "acknowledged" | "in_progress" | "resolved" }) => apiSend(`/api/v1/alerts/${id}`, "PATCH", { status: next }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["alerts"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const all = q.data?.alerts;
  const list = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (all ?? []).filter((a) => {
      if (gangId && a.gangId !== gangId) return false;
      if (priority && a.priority !== priority) return false;
      if (status === "active" && a.status === "resolved") return false;
      if (status && status !== "active" && a.status !== status) return false;
      return !s || a.assetId.toLowerCase().includes(s) || a.message.toLowerCase().includes(s);
    });
  }, [all, gangId, priority, status, search]);
  const openOnes = list.filter((a) => a.status === "open");

  return (
    <div className="space-y-4 p-4 md:p-6">
      <PageTitle title="Pusat alert" description="Alert baru masuk langsung dan muncul sebagai notifikasi di semua halaman." />
      {q.isError ? <Card><ErrorState message={(q.error as Error).message} /></Card> : null}
      {all ? <Stats alerts={all.filter((a) => !gangId || a.gangId === gangId)} /> : <Skeleton className="h-20 rounded-2xl" />}
      <div className="flex flex-wrap items-center gap-2">
        <input aria-label="Cari alert" placeholder="Cari aset atau pesan" value={search} onChange={(e) => setSearch(e.target.value)} className={inputClass} />
        <GangFilter />
        <label htmlFor="priority-filter" className="sr-only">Prioritas</label>
        <select id="priority-filter" value={priority} onChange={(e) => setPriority(e.target.value as AlertPriority | "")} className={selectClass}>
          <option value="">Semua prioritas</option>
          <option value="critical">Kritis</option>
          <option value="high">Tinggi</option>
          <option value="medium">Sedang</option>
          <option value="low">Rendah</option>
        </select>
        <label htmlFor="astatus-filter" className="sr-only">Status penanganan</label>
        <select id="astatus-filter" value={status} onChange={(e) => setStatus(e.target.value as "active" | AlertStatus | "")} className={selectClass}>
          <option value="active">Belum selesai</option>
          <option value="">Semua status</option>
          <option value="open">Terbuka</option>
          <option value="acknowledged">Diterima</option>
          <option value="in_progress">Ditangani</option>
          <option value="resolved">Selesai</option>
        </select>
        {openOnes.length > 1 ? (
          <Button className="ml-auto" disabled={mutate.isPending} onClick={() => openOnes.forEach((a) => mutate.mutate({ id: a.id, next: "acknowledged" }))}>
            <Check className="h-4 w-4" aria-hidden /> Terima {openOnes.length} alert terbuka
          </Button>
        ) : null}
      </div>
      <Card className="overflow-hidden">
        {!all ? <Skeleton className="m-4 h-64" /> : list.length === 0 ? (
          <EmptyState title="Tidak ada alert yang cocok" hint="Ubah filter, atau pilih Semua status untuk melihat riwayat." />
        ) : (
          <ul className="divide-y divide-line">
            {list.map((a) => <AlertRow key={a.id} a={a} busy={mutate.isPending} onChange={(id, next) => mutate.mutate({ id, next })} />)}
          </ul>
        )}
      </Card>
      <DisclaimerNote>Waktu respons dan waktu selesai dihitung dari data simulasi.</DisclaimerNote>
    </div>
  );
}
