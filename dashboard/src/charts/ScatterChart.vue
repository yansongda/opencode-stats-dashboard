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
    /** Scatter data points */
    data: Array<{
      name: string
      x: number
      y: number
      size?: number
    }>
    /** Chart height */
    height?: string
    /** Auto-resize */
    autoresize?: boolean
    /** Theme */
    theme?: string | Record<string, unknown>
    /** Loading state */
    loading?: boolean
    /** X-axis label */
    xLabel?: string
    /** Y-axis label */
    yLabel?: string
    /** Point color */
    pointColor?: string
    /** Tooltip formatter */
    tooltipFormatter?: (params: unknown) => string
  }>(),
  {
    height: '300px',
    autoresize: true,
    theme: undefined,
    loading: false,
    xLabel: '',
    yLabel: '',
    pointColor: undefined,
    tooltipFormatter: undefined,
  },
)

// ── Chart Option ───────────────────────────────────────────────────

const chartOption = computed<EChartsOption | null>(() => {
  if (props.data.length === 0) return null

  const scatterData = props.data.map((d) => ({
    name: d.name,
    value: [d.x, d.y],
    symbolSize: d.size ?? 12,
  }))

  return {
    tooltip: {
      trigger: 'item',
      ...(props.tooltipFormatter
        ? { formatter: props.tooltipFormatter }
        : {}),
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '3%',
      top: 20,
      containLabel: true,
    },
    xAxis: {
      type: 'value',
      name: props.xLabel || undefined,
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
    series: [
      {
        type: 'scatter',
        data: scatterData,
        itemStyle: {
          color: props.pointColor,
        },
        emphasis: {
          itemStyle: {
            shadowBlur: 10,
            shadowColor: 'rgba(0, 0, 0, 0.3)',
          },
        },
      },
    ],
  }
})
</script>
