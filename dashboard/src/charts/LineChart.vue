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
import { computed } from 'vue'
import BaseChart from './BaseChart.vue'
import type { EChartsOption } from 'echarts'

// ── Props ──────────────────────────────────────────────────────────

const props = withDefaults(
  defineProps<{
    /** X-axis labels */
    xData: string[]
    /** Series data: each entry is a named line */
    series: Array<{
      name: string
      data: number[]
      color?: string
    }>
    /** Chart height */
    height?: string
    /** Auto-resize */
    autoresize?: boolean
    /** Theme */
    theme?: string | Record<string, unknown>
    /** Loading state */
    loading?: boolean
    /** Show area fill */
    showArea?: boolean
    /** Show smooth curve */
    smooth?: boolean
    /** Y-axis label */
    yLabel?: string
    /** Tooltip formatter (custom) */
    tooltipFormatter?: (params: unknown) => string
  }>(),
  {
    height: '300px',
    autoresize: true,
    theme: undefined,
    loading: false,
    showArea: false,
    smooth: true,
    yLabel: '',
    tooltipFormatter: undefined,
  },
)

// ── Chart Option ───────────────────────────────────────────────────

const chartOption = computed<EChartsOption>(() => {
  return {
    tooltip: {
      trigger: 'axis',
      ...(props.tooltipFormatter
        ? { formatter: props.tooltipFormatter }
        : {}),
    },
    legend: {
      show: props.series.length > 1,
      top: 0,
      textStyle: {
        fontSize: 12,
      },
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '3%',
      top: props.series.length > 1 ? 40 : 20,
      containLabel: true,
    },
    xAxis: {
      type: 'category',
      data: props.xData,
      boundaryGap: false,
      axisLabel: {
        fontSize: 11,
      },
    },
    yAxis: {
      type: 'value',
      name: props.yLabel || undefined,
      axisLabel: {
        fontSize: 11,
      },
    },
    series: props.series.map((s) => ({
      name: s.name,
      type: 'line' as const,
      data: s.data,
      smooth: props.smooth,
      lineStyle: {
        color: s.color,
        width: 2,
      },
      itemStyle: {
        color: s.color,
      },
      areaStyle: props.showArea
        ? {
            color: s.color,
            opacity: 0.15,
          }
        : undefined,
    })),
  }
})
</script>
