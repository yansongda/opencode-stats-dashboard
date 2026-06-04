<template>
  <div class="trend-card" data-testid="trend-chart">
    <div class="trend-header">
      <span class="trend-title">使用趋势</span>
      <div class="period-tabs">
        <button
          v-for="p in periods"
          :key="p.value"
          class="period-btn"
          :class="{ active: selectedPeriod === p.value }"
          @click="selectedPeriod = p.value"
        >
          {{ p.label }}
        </button>
      </div>
    </div>

    <div v-if="chartData.length === 0" class="trend-empty">
      暂无会话数据
    </div>
    <div v-else-if="allBarsEmpty" class="trend-empty">
      所选时间段内暂无会话，切换到"全部"查看历史数据
    </div>
    <template v-else>
      <div class="chart-area">
        <div class="bars-container">
          <div
            v-for="bar in chartData"
            :key="bar.label"
            class="bar-group"
          >
            <div class="bar-stack">
              <div
                class="bar-segment bar-sessions"
                :style="{ height: `${bar.sessionPct}%` }"
              ></div>
              <div
                class="bar-segment bar-deleted"
                :style="{ height: `${bar.deletedPct}%` }"
              ></div>
            </div>
            <span class="bar-label">{{ bar.label }}</span>
          </div>
        </div>
      </div>

      <div class="legend">
        <div class="legend-item">
          <div class="legend-dot legend-dot-sessions"></div>
          <span class="legend-text">会话数</span>
        </div>
        <div class="legend-item">
          <div class="legend-dot legend-dot-deleted"></div>
          <span class="legend-text">已删除</span>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useStatsStore } from '../stores/stats'

const store = useStatsStore()

const periods = [
  { value: '7d' as const, label: '7天' },
  { value: '30d' as const, label: '30天' },
  { value: 'all' as const, label: '全部' },
]

type Period = '7d' | '30d' | 'all'
const selectedPeriod = ref<Period>('7d')

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

interface BarData {
  label: string
  sessions: number
  deleted: number
  sessionPct: number
  deletedPct: number
}

const chartData = computed((): BarData[] => {
  const sessions = store.sessions.value
  if (sessions.length === 0) return []

  const now = new Date()
  const buckets = new Map<string, { sessions: number; deleted: number }>()

  // Determine cutoff date
  let cutoff: Date | null = null
  if (selectedPeriod.value === '7d') {
    cutoff = new Date(now)
    cutoff.setDate(cutoff.getDate() - 6)
    cutoff.setHours(0, 0, 0, 0)
  } else if (selectedPeriod.value === '30d') {
    cutoff = new Date(now)
    cutoff.setDate(cutoff.getDate() - 29)
    cutoff.setHours(0, 0, 0, 0)
  }

  // Count sessions per day
  for (const s of sessions) {
    const dateStr = s.first_event_at ?? s.last_event_at
    if (!dateStr) continue
    const d = new Date(dateStr.replace(' ', 'T'))
    if (isNaN(d.getTime())) continue
    if (cutoff && d < cutoff) continue

    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const bucket = buckets.get(key) ?? { sessions: 0, deleted: 0 }
    bucket.sessions += 1
    if (s.deleted) bucket.deleted += 1
    buckets.set(key, bucket)
  }

  // Sort by date and build chart data
  const sorted = Array.from(buckets.entries()).sort(([a], [b]) => a.localeCompare(b))

  // For 7d mode, fill in missing days
  let entries: [string, { sessions: number; deleted: number }][]
  if (selectedPeriod.value === '7d') {
    entries = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now)
      d.setDate(d.getDate() - i)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      entries.push([key, buckets.get(key) ?? { sessions: 0, deleted: 0 }])
    }
  } else {
    entries = sorted
  }

  // Find max for scaling
  const maxTotal = Math.max(...entries.map(([, v]) => v.sessions), 1)

  return entries.map(([dateKey, value]) => {
    const d = new Date(dateKey + 'T00:00:00')
    const label = selectedPeriod.value === '7d'
      ? WEEKDAY_SHORT[d.getDay()]
      : `${d.getMonth() + 1}/${d.getDate()}`
    const activeOnly = value.sessions - value.deleted
    return {
      label,
      sessions: value.sessions,
      deleted: value.deleted,
      sessionPct: (activeOnly / maxTotal) * 100,
      deletedPct: (value.deleted / maxTotal) * 100,
    }
  })
})

const allBarsEmpty = computed(() => {
  return chartData.value.length > 0 && chartData.value.every(bar => bar.sessions === 0)
})
</script>

<style scoped>
.trend-card {
  background-color: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: var(--spacing-4);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-3);
}

.trend-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.trend-title {
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--text);
}

.period-tabs {
  display: flex;
  gap: var(--spacing-1);
}

.period-btn {
  font-size: var(--text-xs);
  padding: 2px var(--spacing-2);
  border: none;
  border-radius: 3px;
  cursor: pointer;
  background-color: var(--border);
  color: var(--text-muted);
  transition: all 0.15s ease;
  line-height: 1.4;
}

.period-btn:hover {
  color: var(--text);
}

.period-btn.active {
  background-color: var(--primary);
  color: white;
}

.trend-empty {
  font-size: var(--text-sm);
  color: var(--text-muted);
  padding: var(--spacing-3) 0;
}

.chart-area {
  height: 140px;
  border-bottom: 1px solid var(--border);
  position: relative;
}

.bars-container {
  display: flex;
  align-items: flex-end;
  gap: 4px;
  height: 100%;
  padding-bottom: 0;
}

.bar-group {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  height: 100%;
}

.bar-stack {
  flex: 1;
  display: flex;
  flex-direction: column-reverse;
  width: 100%;
  height: 100%;
}

.bar-segment {
  width: 100%;
  transition: height 0.3s ease;
}

.bar-sessions {
  background-color: var(--primary);
  border-radius: 3px 3px 0 0;
  opacity: 0.7;
}

.bar-deleted {
  background-color: var(--danger);
  border-radius: 0 0 3px 3px;
  opacity: 0.5;
}

.bar-label {
  flex-shrink: 0;
  font-size: 9px;
  color: var(--text-muted);
  margin-top: 4px;
  white-space: nowrap;
}

.legend {
  display: flex;
  gap: var(--spacing-3);
  justify-content: center;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 2px;
}

.legend-dot-sessions {
  background-color: var(--primary);
}

.legend-dot-deleted {
  background-color: var(--danger);
  opacity: 0.5;
}

.legend-text {
  font-size: var(--text-xs);
  color: var(--text-muted);
}
</style>
