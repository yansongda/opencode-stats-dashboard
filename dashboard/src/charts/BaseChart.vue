<template>
  <div class="base-chart" :style="{ height: height }">
    <VChart
      v-if="option"
      :option="mergedOption"
      :autoresize="autoresize"
      :theme="theme"
      :loading="loading"
      :loading-options="loadingOptions"
      :update-options="updateOptions"
    />
    <EmptyState
      v-else
      title="暂无数据"
      description="开始使用 OpenCode 后，数据将自动显示在这里"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { BarChart, LineChart, PieChart, ScatterChart, HeatmapChart } from 'echarts/charts'
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  VisualMapComponent,
} from 'echarts/components'
import EmptyState from '../components/EmptyState.vue'
import type { EChartsOption } from 'echarts'

// Register ECharts components
use([
  CanvasRenderer,
  BarChart,
  LineChart,
  PieChart,
  ScatterChart,
  HeatmapChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  VisualMapComponent,
])

// ── Props ──────────────────────────────────────────────────────────

const props = withDefaults(
  defineProps<{
    /** ECharts option object */
    option?: EChartsOption | null
    /** Chart container height (CSS value) */
    height?: string
    /** Auto-resize on container change */
    autoresize?: boolean
    /** Theme name ('dark') or theme object */
    theme?: string | Record<string, unknown>
    /** Show loading animation */
    loading?: boolean
    /** Loading animation options */
    loadingOptions?: Record<string, unknown>
  }>(),
  {
    option: null,
    height: '300px',
    autoresize: true,
    theme: undefined,
    loading: false,
    loadingOptions: undefined,
  },
)

// ── Merged Option ──────────────────────────────────────────────────

const mergedOption = computed<EChartsOption>(() => {
  if (!props.option) return {}

  return {
    ...props.option,
    animation: true,
    animationDuration: 500,
    animationDurationUpdate: 300,
    animationEasing: 'cubicInOut',
    animationEasingUpdate: 'cubicOut',
  }
})

// ── Update Options ─────────────────────────────────────────────────
// Merge mode (notMerge: false) + lazy update to batch rapid data changes

const updateOptions = {
  notMerge: false,
  lazyUpdate: true,
}
</script>

<style scoped>
.base-chart {
  width: 100%;
  min-height: 100px;
  position: relative;
}
</style>
