import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  Info,
  ShieldAlert,
  WifiOff,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import {
  PRIORITY_LABEL,
  STATUS_LABEL,
  type AlertPriority,
  type AssetStatus,
} from "@/lib/types";
import { cn } from "@/lib/utils";

const STATUS_STYLE: Record<AssetStatus, { icon: LucideIcon; cls: string }> = {
  normal: { icon: CheckCircle2, cls: "bg-st-normal-soft text-st-normal" },
  warning: { icon: AlertTriangle, cls: "bg-st-warning-soft text-st-warning" },
  critical: { icon: AlertOctagon, cls: "bg-st-critical-soft text-st-critical" },
  offline: { icon: WifiOff, cls: "bg-st-offline-soft text-st-offline" },
  maintenance: { icon: Wrench, cls: "bg-st-maintenance-soft text-st-maintenance" },
};

export function StatusBadge({ status, className }: { status: AssetStatus; className?: string }) {
  const { icon: Icon, cls } = STATUS_STYLE[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        cls,
        className,
      )}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {STATUS_LABEL[status]}
    </span>
  );
}

const PRIORITY_STYLE: Record<AlertPriority, { icon: LucideIcon; cls: string }> = {
  critical: { icon: AlertOctagon, cls: "bg-st-critical-soft text-st-critical" },
  high: { icon: ShieldAlert, cls: "bg-st-warning-soft text-st-warning" },
  medium: { icon: AlertTriangle, cls: "bg-st-warning-soft text-st-warning" },
  low: { icon: Info, cls: "bg-st-offline-soft text-st-offline" },
};

export function PriorityBadge({ priority }: { priority: AlertPriority }) {
  const { icon: Icon, cls } = PRIORITY_STYLE[priority];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        cls,
      )}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {PRIORITY_LABEL[priority]}
    </span>
  );
}

export function DisclaimerNote({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("text-xs italic text-ink-3", className)}>{children}</p>;
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 px-6 py-10 text-center">
      <CheckCircle2 className="h-6 w-6 text-ink-3" aria-hidden />
      <p className="text-sm font-medium text-ink">{title}</p>
      {hint ? <p className="max-w-sm text-xs text-ink-3">{hint}</p> : null}
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 px-6 py-10 text-center" role="alert">
      <AlertTriangle className="h-6 w-6 text-st-critical" aria-hidden />
      <p className="text-sm font-medium text-ink">Data tidak dapat dimuat</p>
      <p className="max-w-sm text-xs text-ink-3">{message}</p>
    </div>
  );
}

export function PageTitle({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
        {description ? <p className="mt-0.5 max-w-2xl text-sm text-ink-3">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}
