"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CheckCheck, Play, User } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { useSessionUser } from "@/components/layout/session-context";
import { DisclaimerNote, EmptyState, ErrorState, PageTitle, PriorityBadge } from "@/components/domain/status";
import { Button } from "@/components/ui/button";
import { Card, Skeleton } from "@/components/ui/card";
import { apiGet, apiSend } from "@/lib/client";
import { dateTime, num } from "@/lib/format";
import { can } from "@/lib/rbac";
import type { AlertPriority } from "@/lib/types";
import type { WorkOrderDto, WorkOrderStatus } from "@/lib/workorder-dto";
import { useLive } from "@/stores/live";

/** Compares the stored reading with the live one. Only meaningful once the repair has taken effect. */
function Evaluation({ order }: { order: WorkOrderDto }) {
  const pv = useLive((s) => s.snapshot?.pv.find((p) => p.id === order.assetId));
  const batt = useLive((s) => s.snapshot?.batteries.find((b) => b.id === order.assetId));
  if (order.beforeValue === null) return null;
  const isPv = order.assetType === "pv";
  const now = isPv ? (pv?.ratio ?? 0) * 100 : batt?.tempC;
  const unit = isPv ? "% ekspektasi" : " °C";
  const digits = isPv ? 0 : 1;
  return (
    <div className="mt-2 rounded-lg bg-surface-2 px-3 py-2">
      <p className="text-xs font-medium text-ink-2">{isPv ? "Kinerja sebelum dan sesudah" : "Suhu sebelum dan sesudah"}</p>
      <p className="mt-0.5 flex items-center gap-1.5 text-sm text-ink">
        <span className="num">{num(order.beforeValue, digits)}{unit}</span>
        <ArrowRight className="h-3.5 w-3.5 text-ink-3" aria-hidden />
        <span className="num font-semibold">{num(now, digits)}{unit}</span>
      </p>
      <p className="mt-0.5 text-[11px] text-ink-3">{isPv ? "Dinormalisasi iradiasi, sehingga cuaca tidak memengaruhi perbandingan." : "Pembacaan BMS saat ini."}</p>
    </div>
  );
}

const COLUMNS: { status: WorkOrderStatus; title: string; empty: string }[] = [
  { status: "new", title: "Baru", empty: "Buat perintah kerja dari Pusat Alert." },
  { status: "in_progress", title: "Dikerjakan", empty: "Belum ada pekerjaan berjalan." },
  { status: "done", title: "Selesai", empty: "Belum ada pekerjaan selesai." },
];

export function MaintenanceView() {
  const user = useSessionUser();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["work-orders"], queryFn: () => apiGet<{ orders: WorkOrderDto[] }>("/api/v1/work-orders"), refetchInterval: 5000 });
  const update = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "in_progress" | "done" }) => apiSend(`/api/v1/work-orders/${id}`, "PATCH", { status }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["work-orders"] });
      void qc.invalidateQueries({ queryKey: ["alerts"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const canUpdate = can(user.role, "workorders:update");

  return (
    <div className="space-y-4 p-4 md:p-6">
      <PageTitle title="Pemeliharaan" description="Dari alert, ke perintah kerja, ke pekerjaan selesai, lalu evaluasi hasilnya." action={<Link href="/alerts" className="inline-flex h-9 items-center rounded-lg border border-line bg-surface px-3.5 text-sm font-medium text-ink hover:bg-surface-2">Buka pusat alert</Link>} />
      {q.isError ? <Card><ErrorState message={(q.error as Error).message} /></Card> : null}
      {!q.data && !q.isError ? <Skeleton className="h-72 rounded-2xl" /> : null}
      {q.data ? (
        <div className="grid items-start gap-4 lg:grid-cols-3">
          {COLUMNS.map((c) => {
            const list = q.data.orders.filter((o) => o.status === c.status);
            return (
              <section key={c.status} aria-label={c.title} className="rounded-2xl bg-surface-2 p-3">
                <h2 className="flex items-center justify-between px-1 text-sm font-semibold text-ink">{c.title}<span className="num text-xs font-normal text-ink-3">{list.length}</span></h2>
                {list.length === 0 ? <EmptyState title={c.empty} /> : (
                  <ul className="mt-2 space-y-2">
                    {list.map((o) => (
                      <li key={o.id}>
                        <Card className="p-3">
                          <div className="flex items-center justify-between gap-2">
                            <Link href={o.assetType === "pv" ? `/solar/${o.assetId}` : `/batteries/${o.assetId}`} className="num text-sm font-semibold text-ink hover:underline">{o.assetId}</Link>
                            <PriorityBadge priority={o.priority as AlertPriority} />
                          </div>
                          <p className="mt-1 text-sm text-ink-2">{o.title}</p>
                          <p className="mt-1.5 flex items-center gap-1 text-xs text-ink-3"><User className="h-3 w-3" aria-hidden /> {o.assignee}, {o.zoneId.replace("Z", "Zona ")}</p>
                          <p className="mt-0.5 text-xs text-ink-3">{o.source}, {dateTime(o.createdAt)}</p>
                          {o.status === "done" ? <Evaluation order={o} /> : null}
                          {canUpdate && o.status !== "done" ? (
                            <div className="mt-2.5 flex gap-1.5">
                              {o.status === "new" ? <Button size="sm" disabled={update.isPending} onClick={() => update.mutate({ id: o.id, status: "in_progress" })}><Play className="h-3.5 w-3.5" aria-hidden /> Mulai kerjakan</Button> : null}
                              <Button size="sm" variant="primary" disabled={update.isPending} onClick={() => update.mutate({ id: o.id, status: "done" })}><CheckCheck className="h-3.5 w-3.5" aria-hidden /> Tandai selesai</Button>
                            </div>
                          ) : null}
                        </Card>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      ) : null}
      <DisclaimerNote>Dalam simulasi, menandai selesai memperbaiki aset sehingga pembacaannya pulih. Pada sistem nyata perbaikan perlu diverifikasi admin.</DisclaimerNote>
    </div>
  );
}
