<template>
  <BaseChart
    :option="chartOption"
    :height="height"
    :autoresize="autoresize"
    :theme="theme"
    :loading="loading"
  />
</template>

<script setup lang="ts">
import type { EChartsOption } from "echarts";
import { computed } from "vue";
import BaseChart from "./BaseChart.vue";

// ── Props ──────────────────────────────────────────────────────────

const props = withDefaults(
  defineProps<{
    /** Scatter data points */
    data: Array<{
      name: string;
      x: number;
      y: number;
      size?: number;
    }>;
    /** Chart height */
    height?: string;
    /** Auto-resize */
    autoresize?: boolean;
    /** Theme */
    theme?: string | Record<string, unknown>;
    /** Loading state */
    loading?: boolean;
    /** X-axis label */
    xLabel?: string;
    /** Y-axis label */
    yLabel?: string;
    /** Point color */
    pointColor?: string;
    /** Tooltip formatter */
    tooltipFormatter?: (params: unknown) => string;
    /** X-axis value formatter */
    xValueFormatter?: (value: number) => string;
    /** Y-axis value formatter */
    yValueFormatter?: (value: number) => string;
  }>(),
  {
    height: "300px",
    autoresize: true,
    theme: undefined,
    loading: false,
    xLabel: "",
    yLabel: "",
    pointColor: undefined,
    tooltipFormatter: undefined,
    xValueFormatter: undefined,
    yValueFormatter: undefined,
  },
);

// ── Chart Option ───────────────────────────────────────────────────

const chartOption = computed<EChartsOption | null>(() => {
  if (props.data.length === 0) return null;

  const scatterData = props.data.map((d) => ({
    name: d.name,
    value: [d.x, d.y],
    symbolSize: d.size ?? 12,
  }));

  return {
    tooltip: {
      trigger: "item",
      ...(props.tooltipFormatter
        ? { formatter: props.tooltipFormatter }
        : props.xValueFormatter || props.yValueFormatter
          ? {
              formatter: (params: unknown): string => {
                const p = params as {
                  name: string;
                  value: [number, number];
                  color: string;
                };
                const xFormatted =
                  props.xValueFormatter?.(p.value[0]) ?? String(p.value[0]);
                const yFormatted =
                  props.yValueFormatter?.(p.value[1]) ?? String(p.value[1]);
                return (
                  `<div style="font-size:12px"><div style="margin-bottom:4px">${p.name}</div>` +
                  `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color};margin-right:6px"></span>` +
                  `${props.xLabel || "X"}: <b>${xFormatted}</b><br>` +
                  `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color};margin-right:6px"></span>` +
                  `${props.yLabel || "Y"}: <b>${yFormatted}</b></div>`
                );
              },
            }
          : {}),
    },
    grid: {
      left: "5%",
      right: "5%",
      bottom: 60,
      top: 30,
      containLabel: true,
    },
    xAxis: {
      type: "value",
      name: props.xLabel || undefined,
      nameLocation: "middle",
      nameGap: 35,
      nameTextStyle: {
        fontSize: 12,
      },
      axisLabel: {
        fontSize: 11,
        ...(props.xValueFormatter ? { formatter: props.xValueFormatter } : {}),
      },
    },
    yAxis: {
      type: "value",
      name: props.yLabel || undefined,
      nameLocation: "middle",
      nameGap: 40,
      nameRotate: 90,
      axisLabel: {
        fontSize: 11,
        ...(props.yValueFormatter ? { formatter: props.yValueFormatter } : {}),
      },
    },
    series: [
      {
        type: "scatter",
        data: scatterData,
        itemStyle: {
          color: props.pointColor,
        },
        emphasis: {
          itemStyle: {
            shadowBlur: 10,
            shadowColor: "rgba(0, 0, 0, 0.3)",
          },
        },
      },
    ],
  };
});
</script>
