<template>
  <div class="period-tabs">
    <button
      v-for="p in periods"
      :key="p.value"
      type="button"
      class="period-btn"
      :class="{ active: modelValue === p.value }"
      @click="emit('update:modelValue', p.value)"
    >
      {{ p.label }}
    </button>
  </div>
</template>

<script setup lang="ts">
/**
 * Reusable time-range picker (controlled component).
 *
 * Usage:
 *   <TimeRangePicker v-model="selectedRange" />
 *
 * The parent owns the state; this component only renders
 * buttons and emits `update:modelValue`.
 */

export type TimeRange = '1d' | '7d' | '30d' | 'all'

withDefaults(
  defineProps<{
    modelValue?: TimeRange
  }>(),
  { modelValue: '7d' },
)

const emit = defineEmits<{
  'update:modelValue': [value: TimeRange]
}>()

const periods: Array<{ value: TimeRange; label: string }> = [
  { value: '1d', label: '今日' },
  { value: '7d', label: '7 天' },
  { value: '30d', label: '30 天' },
  { value: 'all', label: '全部' },
]
</script>

<style scoped>
/* ── Period Tabs ─────────────────────────────────────────────────── */
/* Styles mirror the existing .period-tabs / .period-btn pattern
   from OverviewView and EfficiencyView for visual consistency. */

.period-tabs {
  display: flex;
  gap: var(--spacing-1);
}

.period-btn {
  font-size: var(--text-xs);
  padding: 3px var(--spacing-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  cursor: pointer;
  background-color: var(--surface);
  color: var(--text-muted);
  transition: all 0.15s ease;
  line-height: 1.4;
}

.period-btn:hover {
  color: var(--text);
  border-color: var(--primary);
}

.period-btn.active {
  background-color: var(--primary);
  color: white;
  border-color: var(--primary);
}
</style>
