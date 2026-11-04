"use client";
import { useTheme } from "next-themes";
import dynamic from "next/dynamic";
import { useMemo } from "react";
import { clockTime, shortDate } from "@/lib/format";
import { Skeleton } from "@/components/ui/card";
import type { EChartProps } from "./echart-impl";

export const EChart = dynamic<EChartProps>(() => import("./echart-impl"), {
  ssr: false,
  loading: () => <Skeleton className="h-full min-h-40 w-full" />,
});

export interface ChartTheme {
  dark: boolean;
  /** Categorical series order validated with the dataviz palette script. */
  pv: string;
  load: string;
  pln: string;
  battery: string;
  muted: string;
  faint: string;
  grid: string;
  text: string;
  textStrong: string;
  surface: string;
  critical: string;
  warning: string;
  low: string;
  high: string;
}

const LIGHT: ChartTheme = {
  dark: false, pv: "#b45309", load: "#0284c7", pln: "#7c3aed", battery: "#059669", muted: "#64748b", faint: "#94a3b8",
  grid: "#e6edeb", text: "#5f7280", textStrong: "#0e1f2d", surface: "#ffffff", critical: "#c81e1e", high: "#d97706", warning: "#ca8a04", low: "#94a3b8",
};
const DARK: ChartTheme = {
  dark: true, pv: "#d97706", load: "#0891d1", pln: "#8b5cf6", battery: "#0ca678", muted: "#94a3b8", faint: "#64748b",
  grid: "#233249", text: "#8798ab", textStrong: "#e8eff6", surface: "#111b2d", critical: "#f87171", high: "#fb923c", warning: "#fbbf24", low: "#64748b",
};

export function useChartTheme(): ChartTheme {
  const { resolvedTheme } = useTheme();
  return useMemo(() => (resolvedTheme === "dark" ? DARK : LIGHT), [resolvedTheme]);
}

export const FONT = "var(--font-jakarta), system-ui, sans-serif";

export function tooltip(t: ChartTheme) {
  return {
    trigger: "axis" as const,
    backgroundColor: t.surface,
    borderColor: t.grid,
    textStyle: { color: t.textStrong, fontSize: 12, fontFamily: FONT },
    axisPointer: { type: "line" as const, lineStyle: { color: t.faint, width: 1 } },
    confine: true,
  };
}

export function legend(t: ChartTheme) {
  return { top: 0, left: 40, icon: "roundRect", itemWidth: 12, itemHeight: 3, itemGap: 16, textStyle: { color: t.text, fontSize: 12, fontFamily: FONT } };
}

export function grid(extra: object = {}) {
  return { left: 44, right: 14, top: 34, bottom: 24, ...extra };
}

export function timeAxis(t: ChartTheme, kind: "clock" | "date" = "clock", extra: object = {}) {
  return {
    type: "time" as const,
    axisLine: { lineStyle: { color: t.grid } },
    axisTick: { show: false },
    splitLine: { show: false },
    axisLabel: {
      color: t.text,
      fontSize: 11,
      hideOverlap: true,
      formatter: (v: number) => (kind === "clock" ? clockTime(v / 1000) : shortDate(v / 1000)),
    },
    ...extra,
  };
}

export function valueAxis(t: ChartTheme, name: string, extra: object = {}) {
  return {
    type: "value" as const,
    name,
    nameTextStyle: { color: t.text, fontSize: 11, align: "left" as const, padding: [0, 0, 0, -30] },
    axisLabel: { color: t.text, fontSize: 11 },
    splitLine: { lineStyle: { color: t.grid } },
    ...extra,
  };
}

/** Tooltip header in WIB, since ECharts would otherwise use the browser's timezone. */
export function axisTooltip(unit: string | ((name: string) => string), kind: "clock" | "date" = "clock", digits = 1) {
  return (params: unknown) => {
    const list = (Array.isArray(params) ? params : [params]) as { axisValue?: number; value: [number, number | null]; seriesName: string; marker: string }[];
    const ts = (list[0]?.axisValue ?? list[0]?.value?.[0] ?? 0) / 1000;
    const head = kind === "clock" ? `${clockTime(ts)} WIB` : shortDate(ts);
    const rows = list
      .filter((p) => p.value[1] !== null && p.value[1] !== undefined)
      .map((p) => {
        const u = typeof unit === "function" ? unit(p.seriesName) : unit;
        const v = new Intl.NumberFormat("id-ID", { maximumFractionDigits: digits }).format(p.value[1] as number);
        return `<div style="display:flex;justify-content:space-between;gap:16px">${p.marker}<span style="flex:1">${p.seriesName}</span><b>${v} ${u}</b></div>`;
      })
      .join("");
    return `<div style="font-size:11px;opacity:.75;margin-bottom:4px">${head}</div>${rows}`;
  };
}
