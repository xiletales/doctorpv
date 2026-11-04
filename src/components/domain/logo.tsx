import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("h-8 w-8 shrink-0", className)} aria-hidden>
      <rect width="32" height="32" rx="8" fill="#12293f" />
      <circle cx="16" cy="13" r="5" fill="#f59e0b" />
      <path d="M6 25l4-8h12l4 8z" fill="#10b981" />
      <path d="M13 17l-1.5 8M19 17l1.5 8M8.5 21h15" stroke="#12293f" strokeWidth="1.2" />
    </svg>
  );
}
