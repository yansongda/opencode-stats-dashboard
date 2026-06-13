<template>
  <div class="metric-card" :data-testid="testId">
    <div v-if="!hasDual" class="metric-label">{{ label }}</div>
    <div v-if="hasDual" class="metric-value-dual">
      <div class="metric-value-primary">
        <span v-if="secondaryLabel" class="metric-value-label">{{ label }}</span>
        <span :data-testid="testId ? `${testId}-primary` : undefined">{{ displayValue }}</span>
      </div>
      <span class="metric-value-separator">/</span>
      <div class="metric-value-secondary">
        <span v-if="secondaryLabel" class="metric-value-label">{{ secondaryLabel }}</span>
        <span :data-testid="testId ? `${testId}-secondary` : undefined">{{ displaySecondaryValue }}</span>
      </div>
    </div>
    <div v-else class="metric-value">{{ displayValue }}</div>
    <div v-if="trend" class="metric-trend" :class="trendClass">
      <span class="trend-arrow">{{ trendArrow }}</span>
      <span class="trend-text">{{ trend }}</span>
    </div>
    <div v-if="subtitle" class="metric-subtitle">{{ subtitle }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  label: string;
  value: string | number;
  secondaryValue?: string | number;
  secondaryLabel?: string;
  trend?: string;
  trendDirection?: "up" | "down" | "neutral";
  subtitle?: string;
  testId?: string;
}>();

const hasDual = computed(
  () => props.secondaryValue != null && props.secondaryValue !== "",
);

const displayValue = computed(() => {
  if (typeof props.value === "number") {
    return props.value.toLocaleString();
  }
  return props.value;
});

const displaySecondaryValue = computed(() => {
  if (props.secondaryValue == null) return "";
  if (typeof props.secondaryValue === "number") {
    return props.secondaryValue.toLocaleString();
  }
  return props.secondaryValue;
});

const trendClass = computed(() => {
  if (!props.trendDirection || props.trendDirection === "neutral")
    return "trend-neutral";
  return props.trendDirection === "up" ? "trend-up" : "trend-down";
});

const trendArrow = computed(() => {
  if (!props.trendDirection || props.trendDirection === "neutral") return "→";
  return props.trendDirection === "up" ? "↑" : "↓";
});
</script>

<style scoped>
.metric-card {
  background-color: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: var(--spacing-4);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-1);
  min-width: 0;
  transition: border-color 0.2s ease;
}

.metric-card:hover {
  border-color: var(--primary);
}

.metric-label {
  font-size: var(--text-sm);
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.metric-value {
  font-size: var(--text-2xl);
  font-weight: 700;
  color: var(--text);
  line-height: 1.2;
}

.metric-value-dual {
  display: flex;
  align-items: baseline;
  gap: var(--spacing-2);
  line-height: 1.2;
}

.metric-value-primary,
.metric-value-secondary {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.metric-value-primary span:last-child,
.metric-value-secondary span:last-child {
  font-size: var(--text-2xl);
  font-weight: 700;
  color: var(--text);
}

.metric-value-label {
  font-size: var(--text-sm);
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.metric-value-separator {
  font-size: var(--text-xl);
  font-weight: 300;
  color: var(--text-muted);
  opacity: 0.5;
  user-select: none;
}

.metric-trend {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-1);
  font-size: var(--text-xs);
  font-weight: 500;
  padding: 2px var(--spacing-2);
  border-radius: var(--radius-lg);
  width: fit-content;
}

.trend-up {
  color: var(--success);
  background-color: rgba(34, 197, 94, 0.1);
}

.trend-down {
  color: var(--danger);
  background-color: rgba(239, 68, 68, 0.1);
}

.trend-neutral {
  color: var(--text-muted);
  background-color: rgba(148, 163, 184, 0.1);
}

.trend-arrow {
  font-size: var(--text-xs);
}

.trend-text {
  white-space: nowrap;
}

.metric-subtitle {
  font-size: var(--text-xs);
  color: var(--text-muted);
  margin-top: auto;
}

@media (max-width: 375px) {
  .metric-value-dual {
    flex-direction: column;
    align-items: flex-start;
    gap: var(--spacing-1);
  }

  .metric-value-separator {
    display: none;
  }
}
</style>
