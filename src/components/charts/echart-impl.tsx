"use client";
import ReactEChartsCore from "echarts-for-react/lib/core";
import { BarChart, GaugeChart, HeatmapChart, LineChart, SankeyChart } from "echarts/charts";
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  MarkPointComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import type { CSSProperties } from "react";

echarts.use([
  LineChart, BarChart, GaugeChart, HeatmapChart, SankeyChart,
  GridComponent, LegendComponent, TooltipComponent, MarkAreaComponent, MarkLineComponent, MarkPointComponent,
  VisualMapComponent, DataZoomComponent, CanvasRenderer,
]);

export interface EChartProps {
  option: object;
  style?: CSSProperties;
  ariaLabel: string;
}

export default function EChartImpl({ option, style, ariaLabel }: EChartProps) {
  return (
    <div role="img" aria-label={ariaLabel}>
      <ReactEChartsCore echarts={echarts} option={option} style={style} notMerge lazyUpdate opts={{ renderer: "canvas" }} />
    </div>
  );
}
