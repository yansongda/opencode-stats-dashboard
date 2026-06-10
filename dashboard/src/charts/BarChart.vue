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
    /** Series data: each entry is a named bar set */
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
    /** Horizontal layout (bars go left-to-right) */
    horizontal?: boolean
    /** Stacked bars */
    stacked?: boolean
    /** Y-axis label */
    yLabel?: string
    /** Tooltip formatter */
    tooltipFormatter?: (params: unknown) => string
    /** Value-axis formatter (e.g. formatTokens for K/M/B) */
    valueFormatter?: (value: number) => string
  }>(),
  {
    height: '300px',
    autoresize: true,
    theme: undefined,
    loading: false,
    horizontal: false,
    stacked: false,
    yLabel: '',
    tooltipFormatter: undefined,
    valueFormatter: undefined,
  },
)

// ── Chart Option ───────────────────────────────────────────────────

const chartOption = computed<EChartsOption | null>(() => {
  if (props.xData.length === 0 || props.series.length === 0) return null

  const categoryAxis = {
    type: 'category' as const,
    data: props.xData,
    axisLabel: {
      fontSize: 11,
      rotate: props.xData.length > 8 ? 45 : 0,
    },
  }

  const valueAxis = {
    type: 'value' as const,
    name: props.yLabel || undefined,
    axisLabel: {
      fontSize: 11,
      ...(props.valueFormatter ? { formatter: props.valueFormatter } : {}),
    },
  }

  const xAxis = props.horizontal ? valueAxis : categoryAxis
  const yAxis = props.horizontal ? categoryAxis : valueAxis

  const defaultTooltipFormatter = props.valueFormatter
    ? (params: unknown): string => {
        const list = params as Array<{
          axisValueLabel: string
          seriesName: string
          value: number
          color: string
        }>
        if (!Array.isArray(list) || list.length === 0) return ''
        const header = list[0].axisValueLabel ?? ''
        const lines = list.map(
          (p) => `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color};margin-right:6px"></span>${p.seriesName}: <b>${props.valueFormatter?.(p.value) ?? p.value}</b>`,
        )
        return `<div style="font-size:12px">${header ? `<div style="margin-bottom:4px">${header}</div>` : ''}${lines.join('<br>')}</div>`
      }
    : undefined

  return {
    tooltip: {
      trigger: 'axis',
      ...(props.tooltipFormatter
        ? { formatter: props.tooltipFormatter }
        : defaultTooltipFormatter
          ? { formatter: defaultTooltipFormatter }
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
    xAxis,
    yAxis,
    series: props.series.map((s, idx) => ({
      name: s.name,
      type: 'bar' as const,
      data: s.data,
      stack: props.stacked ? 'total' : undefined,
      barMaxWidth: 40,
      itemStyle: {
        color: s.color,
        borderRadius: props.horizontal
          ? [0, 4, 4, 0]
          : idx === props.series.length - 1
            ? [4, 4, 0, 0]
            : [0, 0, 0, 0],
      },
    })),
  }
})
</script>
