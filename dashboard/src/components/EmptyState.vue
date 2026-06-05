<template>
  <div class="empty-state" :class="variantClass" :data-testid="testId">
    <div class="empty-icon">{{ icon }}</div>
    <div class="empty-content">
      <h3 class="empty-title">{{ title }}</h3>
      <p v-if="description" class="empty-description">{{ description }}</p>
    </div>
    <button
      v-if="actionLabel"
      class="empty-action"
      @click="$emit('action')"
    >
      {{ actionLabel }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

type EmptyStateVariant = 'empty' | 'error'

const props = withDefaults(
  defineProps<{
    variant?: EmptyStateVariant
    title: string
    description?: string
    actionLabel?: string
    testId?: string
  }>(),
  {
    variant: 'empty',
    testId: 'empty-state',
  },
)

defineEmits<{
  action: []
}>()

const icon = computed(() => {
  return props.variant === 'error' ? '⚠' : '📭'
})

const variantClass = computed(() => `variant-${props.variant}`)
</script>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--spacing-6) var(--spacing-4);
  text-align: center;
  gap: var(--spacing-3);
  min-height: 120px;
}

.empty-icon {
  font-size: 32px;
  line-height: 1;
  opacity: 0.6;
}

.empty-content {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-1);
}

.empty-title {
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--text);
  margin: 0;
}

.empty-description {
  font-size: var(--text-sm);
  color: var(--text-muted);
  margin: 0;
  max-width: 280px;
  line-height: 1.5;
}

.empty-action {
  margin-top: var(--spacing-2);
  padding: var(--spacing-2) var(--spacing-4);
  font-size: var(--text-sm);
  font-weight: 500;
  color: white;
  background-color: var(--primary);
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.empty-action:hover {
  background-color: var(--primary-hover);
}

/* Variant: error */
.variant-error .empty-icon {
  opacity: 0.8;
}

.variant-error .empty-title {
  color: var(--danger);
}

.variant-error .empty-action {
  background-color: var(--danger);
}

.variant-error .empty-action:hover {
  background-color: #b91c1c;
}
</style>
