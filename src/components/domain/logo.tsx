import { useId } from "react";
import { cn } from "@/lib/utils";

/** The sun with a heartbeat line through it: energy that is alive and monitored. */
export function LogoMark({ className }: { className?: string }) {
  const id = useId();
  return (
    <svg viewBox="0 0 32 32" className={cn("h-8 w-8 shrink-0", className)} aria-hidden>
      <defs>
        <linearGradient id={id} x1="4" y1="4" x2="28" y2="28" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FBBF24" />
          <stop offset="0.55" stopColor="#F97316" />
          <stop offset="1" stopColor="#FB7185" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="13" fill={`url(#${id})`} />
      <path d="M1 17h8l2.500-5 4 11 3.500-14 2.500 8H31" fill="none" stroke="#070B14" strokeWidth="2.400" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
