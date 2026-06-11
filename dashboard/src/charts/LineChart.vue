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
      /** Y-axis index (0 = left, 1 = right). Defaults to 0. */
      yAxisIndex?: number
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
    /** Y-axis value formatter (e.g. formatTokens for K/M/B) */
    valueFormatter?: (value: number) => string
    /** Right y-axis label (enables dual y-axis when set) */
    rightYLabel?: string
    /** Right y-axis value formatter */
    rightValueFormatter?: (value: number) => string
    /** Force legend visibility even with a single series */
    showLegend?: boolean
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
    valueFormatter: undefined,
    rightYLabel: '',
    rightValueFormatter: undefined,
    showLegend: false,
  },
)

// ── Chart Option ───────────────────────────────────────────────────

  const hasDualAxis = computed(() => !!props.rightYLabel)
  const showLegend = computed(() => props.showLegend || props.series.length > 1)

const chartOption = computed<EChartsOption | null>(() => {
  if (props.xData.length === 0 || props.series.length === 0) return null

  // Build a formatter lookup by yAxisIndex for the tooltip
  const formatterByAxis: Record<number, ((v: number) => string) | undefined> = {
    0: props.valueFormatter,
    1: props.rightValueFormatter,
  }

  const defaultTooltipFormatter =
    props.valueFormatter || props.rightValueFormatter
      ? (params: unknown): string => {
          const list = params as Array<{
            axisValueLabel: string
            seriesName: string
            value: number
            color: string
            seriesIndex: number
          }>
          if (!Array.isArray(list) || list.length === 0) return ''
          const header = list[0].axisValueLabel ?? ''
          const lines = list.map((p) => {
            // Resolve yAxisIndex from series config (default 0)
            const idx = props.series[p.seriesIndex]?.yAxisIndex ?? 0
            const fmt = formatterByAxis[idx]
            const formatted = fmt ? fmt(p.value) : String(p.value)
            return `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color};margin-right:6px"></span>${p.seriesName}: <b>${formatted}</b>`
          })
          return `<div style="font-size:12px">${header ? `<div style="margin-bottom:4px">${header}</div>` : ''}${lines.join('<br>')}</div>`
        }
      : undefined

  const dualAxis = hasDualAxis.value
  const rightGap = dualAxis ? '6%' : '4%'

  const yAxisConfig: EChartsOption['yAxis'] = dualAxis
    ? [
        {
          type: 'value' as const,
          name: props.yLabel || undefined,
          axisLabel: {
            fontSize: 11,
            ...(props.valueFormatter ? { formatter: props.valueFormatter } : {}),
          },
        },
        {
          type: 'value' as const,
          name: props.rightYLabel || undefined,
          axisLabel: {
            fontSize: 11,
            ...(props.rightValueFormatter
              ? { formatter: props.rightValueFormatter }
              : {}),
          },
        },
      ]
    : {
        type: 'value' as const,
        name: props.yLabel || undefined,
        axisLabel: {
          fontSize: 11,
          ...(props.valueFormatter ? { formatter: props.valueFormatter } : {}),
        },
      }

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
      show: showLegend.value,
      top: 0,
      textStyle: {
        fontSize: 12,
      },
    },
    grid: {
      left: '3%',
      right: rightGap,
      bottom: '3%',
      top: showLegend.value ? 40 : 20,
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
    yAxis: yAxisConfig,
    series: props.series.map((s) => ({
      name: s.name,
      type: 'line' as const,
      data: s.data,
      yAxisIndex: s.yAxisIndex ?? 0,
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
