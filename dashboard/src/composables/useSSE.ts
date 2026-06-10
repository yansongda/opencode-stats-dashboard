/**
 * useSSE — Vue composable for SSE connection management.
 *
 * Provides:
 * - SSE connection lifecycle (connect/disconnect/reconnect)
 * - Exponential backoff reconnect with configurable base/max interval
 * - Max reconnect attempts with fallback to polling
 * - StatsNotification message parsing with type guard validation
 * - Single onNotification callback for validated notifications
 * - Status indicator (green/yellow/red dot)
 * - Last sync time tracking
 *
 * Design reference: docs/superpowers/specs/2026-06-04-event-sourced-stats-engine-design.md §6.3–6.6, §11.8
 */

import { ref, computed, type Ref, type ComputedRef } from 'vue'
import {
  isStatsNotification,
  SSE_EVENT_NAME,
  type StatsNotification,
  type SSEConnectionState,
} from '../../../src/types/stream'
import { connectSSE } from '../api/client'

// ============================================================================
// Types
// ============================================================================

export type StatusDot = 'green' | 'yellow' | 'red'

export interface UseSSEOptions {
  url?: string

  /** @deprecated Use reconnectBaseInterval instead */
  reconnectInterval?: number

  /** Base reconnect interval in ms (default: 1000) */
  reconnectBaseInterval?: number

  /** Max reconnect interval in ms after exponential backoff (default: 30000) */
  reconnectMaxInterval?: number

  /** Max reconnect attempts before giving up (default: 10) */
  maxReconnectAttempts?: number

  /** Fallback polling function called when max attempts reached */
  fallbackToPolling?: () => Promise<void>

  /** Polling interval in ms when in fallback mode (default: 10000) */
  pollingInterval?: number

  /** Called for each validated StatsNotification received via SSE */
  onNotification?: (notification: StatsNotification) => void

  /** Called when SSE reconnects after a disconnect (not on initial open) */
  onOpen?: () => void
}

export interface UseSSEReturn {
  connectionState: Ref<SSEConnectionState>
  lastSyncTime: Ref<Date | null>
  hasNewData: Ref<boolean>
  reconnectInterval: Ref<number>
  reconnectAttempts: Ref<number>
  isFallbackPolling: Ref<boolean>
  statusDot: ComputedRef<StatusDot>
  statusLabel: ComputedRef<string>
  connect: () => void
  disconnect: () => void
  reconnect: () => void
  markSynced: () => void
}

// ============================================================================
// Implementation
// ============================================================================

export function useSSE(options: UseSSEOptions = {}): UseSSEReturn {
  const {
    reconnectInterval: legacyReconnectInterval = 5000,
    reconnectBaseInterval = 1000,
    reconnectMaxInterval = 30_000,
    maxReconnectAttempts = 10,
    fallbackToPolling,
    pollingInterval = 10_000,
    onNotification,
    onOpen,
  } = options

  const baseInterval = options.reconnectBaseInterval !== undefined
    ? reconnectBaseInterval
    : legacyReconnectInterval

  // ── Reactive State ─────────────────────────────────────────────────

  const connectionState = ref<SSEConnectionState>('disconnected') as Ref<SSEConnectionState>
  const lastSyncTime = ref<Date | null>(null) as Ref<Date | null>
  const hasNewData = ref(false) as Ref<boolean>
  const reconnectInterval = ref(baseInterval) as Ref<number>
  const reconnectAttempts = ref(0) as Ref<number>
  const isFallbackPolling = ref(false) as Ref<boolean>

  // ── Internal State ─────────────────────────────────────────────────

  let eventSource: EventSource | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let pollingTimer: ReturnType<typeof setInterval> | null = null
  let intentionalClose = false
  let pendingReconnect = false

  // ── Derived State ──────────────────────────────────────────────────

  const statusDot = computed<StatusDot>(() => {
    if (connectionState.value === 'disconnected' || connectionState.value === 'reconnecting') {
      return 'red'
    }
    if (hasNewData.value) {
      return 'yellow'
    }
    return 'green'
  })

  const statusLabel = computed<string>(() => {
    switch (connectionState.value) {
      case 'disconnected':
        return '连接断开'
      case 'reconnecting':
        return '正在重连'
      case 'connecting':
        return '连接中'
      case 'connected':
        return hasNewData.value ? '有新数据' : '数据已同步'
    }
  })

  // ── Message Handler ────────────────────────────────────────────────

  function handleMessage(event: MessageEvent): void {
    let parsed: unknown
    try {
      parsed = JSON.parse(event.data)
    } catch {
      return
    }

    if (!isStatsNotification(parsed)) {
      return
    }

    hasNewData.value = true
    lastSyncTime.value = new Date()

    onNotification?.(parsed)
  }

  // ── Reconnect Logic ────────────────────────────────────────────────

  function scheduleReconnect(): void {
    if (intentionalClose) return

    reconnectAttempts.value++

    if (reconnectAttempts.value >= maxReconnectAttempts) {
      connectionState.value = 'disconnected'
      if (fallbackToPolling) {
        startPollingFallback()
      }
      return
    }

    pendingReconnect = true
    connectionState.value = 'reconnecting'
    clearReconnectTimer()

    const backoffInterval = Math.min(
      baseInterval * Math.pow(2, reconnectAttempts.value - 1),
      reconnectMaxInterval,
    )
    reconnectInterval.value = backoffInterval

    reconnectTimer = setTimeout(() => {
      if (!intentionalClose) {
        doConnect()
      }
    }, backoffInterval)
  }

  function clearReconnectTimer(): void {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
  }

  function startPollingFallback(): void {
    isFallbackPolling.value = true
    clearPollingTimer()

    fallbackToPolling?.()

    pollingTimer = setInterval(() => {
      fallbackToPolling?.()
    }, pollingInterval)
  }

  function clearPollingTimer(): void {
    if (pollingTimer !== null) {
      clearInterval(pollingTimer)
      pollingTimer = null
    }
  }

  // ── Connection Lifecycle ───────────────────────────────────────────

  function doConnect(): void {
    if (eventSource && connectionState.value !== 'disconnected' && connectionState.value !== 'reconnecting') {
      return
    }

    closeEventSource()

    connectionState.value = 'connecting'
    intentionalClose = false

    try {
      eventSource = connectSSE()

      eventSource.addEventListener(SSE_EVENT_NAME, handleMessage as EventListener)

      eventSource.addEventListener('open', () => {
        const isReconnect = pendingReconnect
        pendingReconnect = false
        connectionState.value = 'connected'
        reconnectAttempts.value = 0
        reconnectInterval.value = baseInterval
        clearPollingTimer()
        isFallbackPolling.value = false
        if (isReconnect) {
          onOpen?.()
        }
      })

      eventSource.onerror = () => {
        closeEventSource()
        scheduleReconnect()
      }
    } catch {
      connectionState.value = 'disconnected'
      scheduleReconnect()
    }
  }

  function closeEventSource(): void {
    if (eventSource) {
      eventSource.close()
      eventSource = null
    }
  }

  // ── Public API ─────────────────────────────────────────────────────

  function connect(): void {
    intentionalClose = false
    pendingReconnect = false
    reconnectAttempts.value = 0
    reconnectInterval.value = baseInterval
    doConnect()
  }

  function disconnect(): void {
    intentionalClose = true
    clearReconnectTimer()
    clearPollingTimer()
    closeEventSource()
    connectionState.value = 'disconnected'
    isFallbackPolling.value = false
  }

  function reconnect(): void {
    intentionalClose = false
    pendingReconnect = true
    clearReconnectTimer()
    clearPollingTimer()
    closeEventSource()
    isFallbackPolling.value = false
    reconnectAttempts.value = 0
    reconnectInterval.value = baseInterval
    connectionState.value = 'disconnected'
    doConnect()
  }

  function markSynced(): void {
    hasNewData.value = false
    lastSyncTime.value = new Date()
  }

  return {
    connectionState,
    lastSyncTime,
    hasNewData,
    reconnectInterval,
    reconnectAttempts,
    isFallbackPolling,
    statusDot,
    statusLabel,
    connect,
    disconnect,
    reconnect,
    markSynced,
  }
}
