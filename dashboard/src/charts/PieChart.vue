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
    /** Pie data entries */
    data: Array<{
      name: string
      value: number
    }>
    /** Chart height */
    height?: string
    /** Auto-resize */
    autoresize?: boolean
    /** Theme */
    theme?: string | Record<string, unknown>
    /** Loading state */
    loading?: boolean
    /** Show as donut (ring) */
    donut?: boolean
    /** Inner radius ratio (0-1) for donut */
    innerRadius?: number
    /** Show labels */
    showLabel?: boolean
    /** Tooltip formatter */
    tooltipFormatter?: (params: unknown) => string
  }>(),
  {
    height: '300px',
    autoresize: true,
    theme: undefined,
    loading: false,
    donut: false,
    innerRadius: 0.55,
    showLabel: true,
    tooltipFormatter: undefined,
  },
)

// ── Chart Option ───────────────────────────────────────────────────

const chartOption = computed<EChartsOption>(() => {
  const radius = props.donut
    ? [`${Math.round(props.innerRadius * 100)}%`, '70%']
    : ['0%', '70%']

  return {
    tooltip: {
      trigger: 'item',
      ...(props.tooltipFormatter
        ? { formatter: props.tooltipFormatter }
        : {}),
    },
    legend: {
      orient: 'vertical',
      right: '5%',
      top: 'center',
      textStyle: {
        fontSize: 12,
      },
    },
    series: [
      {
        type: 'pie',
        radius,
        center: ['40%', '50%'],
        data: props.data,
        label: {
          show: props.showLabel,
          fontSize: 11,
        },
        emphasis: {
          itemStyle: {
            shadowBlur: 10,
            shadowOffsetX: 0,
            shadowColor: 'rgba(0, 0, 0, 0.3)',
          },
        },
      },
    ],
  }
})
</script>
