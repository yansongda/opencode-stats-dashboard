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

// ── Types ──────────────────────────────────────────────────────────

interface HeatmapCell {
  /** Day index (0=Mon, 6=Sun) */
  day: number
  /** Hour index (0-23) */
  hour: number
  /** Value (e.g., message count) */
  value: number
}

// ── Props ──────────────────────────────────────────────────────────

const props = withDefaults(
  defineProps<{
    /** Heatmap data points */
    data: HeatmapCell[]
    /** Chart height */
    height?: string
    /** Auto-resize */
    autoresize?: boolean
    /** Theme */
    theme?: string | Record<string, unknown>
    /** Loading state */
    loading?: boolean
    /** Day labels (default: Mon-Sun) */
    dayLabels?: string[]
    /** Min color for heatmap */
    minColor?: string
    /** Max color for heatmap */
    maxColor?: string
  }>(),
  {
    height: '300px',
    autoresize: true,
    theme: undefined,
    loading: false,
    dayLabels: () => ['周一', '周二', '周三', '周四', '周五', '周六', '周日'],
    minColor: '#ebedf0',
    maxColor: '#40c463',
  },
)

// ── Chart Option ───────────────────────────────────────────────────

const hours = Array.from({ length: 24 }, (_, i) => `${i}:00`)

const chartOption = computed<EChartsOption | null>(() => {
  if (props.data.length === 0) return null

  const valueByCell = new Map<string, number>()
  for (const cell of props.data) {
    valueByCell.set(`${cell.day}:${cell.hour}`, cell.value)
  }

  const maxVal = Math.max(...props.data.map((d) => d.value), 1)

  // Convert to [hour, day, value] format for ECharts heatmap.
  // Fill every weekday/hour cell so empty slots render as the min color.
  const heatData: Array<[number, number, number]> = []
  for (let day = 0; day < 7; day++) {
    for (let hour = 0; hour < 24; hour++) {
      heatData.push([hour, day, valueByCell.get(`${day}:${hour}`) ?? 0])
    }
  }

  return {
    tooltip: {
      position: 'top',
      formatter: (params: unknown) => {
        const p = params as { data: [number, number, number] }
        if (!p.data) return ''
        const hour = p.data[0]
        const day = props.dayLabels[p.data[1]] ?? `Day ${p.data[1]}`
        return `${day} ${hour}:00<br/>消息数: ${p.data[2]}`
      },
    },
    grid: {
      left: '10%',
      right: '15%',
      bottom: '15%',
      top: '10%',
      containLabel: false,
    },
    xAxis: {
      type: 'category',
      data: hours,
      splitArea: { show: true },
      axisLabel: {
        fontSize: 10,
        interval: 2,
      },
    },
    yAxis: {
      type: 'category',
      data: props.dayLabels,
      inverse: true,
      splitArea: { show: true },
      axisLabel: {
        fontSize: 11,
      },
    },
    visualMap: {
      min: 0,
      max: maxVal,
      calculable: true,
      orient: 'vertical',
      right: '2%',
      top: 'center',
      inRange: {
        color: [props.minColor, props.maxColor],
      },
      textStyle: {
        fontSize: 11,
      },
    },
    series: [
      {
        type: 'heatmap',
        data: heatData,
        label: { show: false },
        emphasis: {
          itemStyle: {
            shadowBlur: 10,
            shadowColor: 'rgba(0, 0, 0, 0.5)',
          },
        },
      },
    ],
  }
})
</script>
