<template>
  <div class="base-chart" :style="{ height: height }">
    <VChart
      v-if="option"
      :option="mergedOption"
      :autoresize="autoresize"
      :theme="theme"
      :loading="loading"
      :loading-options="loadingOptions"
    />
    <div v-else class="chart-empty">
      <slot name="empty">
        <span class="chart-empty-text">暂无数据</span>
      </slot>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import VChart from 'vue-echarts'
import type { EChartsOption } from 'echarts'

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
    animationEasing: 'cubicInOut',
  }
})
</script>

<style scoped>
.base-chart {
  width: 100%;
  min-height: 100px;
  position: relative;
}

.chart-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 100px;
}

.chart-empty-text {
  color: var(--text-muted, #8c8c8c);
  font-size: var(--text-sm, 14px);
}
</style>
