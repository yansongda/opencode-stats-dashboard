/**
 * Route-aware SSE connection manager for dashboard pages.
 *
 * SSE frames are lightweight invalidation notices. This composable coalesces
 * notices into silent route refreshes, keeps a fallback polling loop active,
 * and exposes connection state for the dashboard status indicator.
 */

import { isStatsNotification, SSE_EVENT_NAME } from "@opencode-stats/shared";
import { type ComputedRef, computed, type Ref, ref } from "vue";
import { useRouter } from "vue-router";
import { connectSSE } from "../api/client";
import { useEfficiencyStore } from "../stores/efficiency";
import { useModelsStore } from "../stores/models";
import { useOverviewStore } from "../stores/overview";
import { useProjectsStore } from "../stores/projects";
import { useSessionsStore } from "../stores/sessions";
import { useToolsStore } from "../stores/tools";

// ============================================================================
// Types
// ============================================================================

export type RealtimeMode = "sse" | "polling" | "disconnected";
export type StatusDot = "green" | "yellow" | "red";

export interface UseSSEReturn {
  connectionState: Ref<
    "disconnected" | "reconnecting" | "connecting" | "connected"
  >;
  lastSyncTime: Ref<Date | null>;
  hasNewData: Ref<boolean>;
  reconnectInterval: Ref<number>;
  reconnectAttempts: Ref<number>;
  isFallbackPolling: Ref<boolean>;
  statusDot: ComputedRef<StatusDot>;
  statusLabel: ComputedRef<string>;
  realtimeMode: Ref<RealtimeMode>;
  lastUpdatedAt: Ref<Date | null>;
  lastDataUpdatedAt: Ref<Date | null>;
  refreshing: Ref<boolean>;
  connect: () => void;
  disconnect: () => void;
  reconnect: () => void;
  markSynced: () => void;
  refreshCurrentRoute: (silent?: boolean) => Promise<boolean>;
  cancelDebouncedRefresh: () => void;
}

// ============================================================================
// Constants
// ============================================================================

const RECONNECT_BASE_INTERVAL = 1000;
const RECONNECT_MAX_INTERVAL = 30_000;
const MAX_RECONNECT_ATTEMPTS = 10;
const SSE_REFRESH_WAIT_MS = 10_000;
const FALLBACK_REFRESH_INTERVAL_MS = 30_000;

// ============================================================================
// Implementation
// ============================================================================

export function useSSE(): UseSSEReturn {
  const router = useRouter();

  // ── Route-Aware Refresh ────────────────────────────────────────────

  const routeRefreshMap: Record<string, (silent: boolean) => Promise<boolean>> =
    {
      overview: (silent) =>
        useOverviewStore().fetchOverview(undefined, undefined, { silent }),
      efficiency: (silent) =>
        useEfficiencyStore().fetchEfficiency(undefined, undefined, { silent }),
      models: (silent) =>
        useModelsStore().fetchModels(undefined, undefined, { silent }),
      projects: (silent) =>
        useProjectsStore().fetchProjects(undefined, undefined, undefined, {
          silent,
        }),
      tools: (silent) =>
        useToolsStore().fetchTools(undefined, undefined, { silent }),
      sessions: (silent) =>
        useSessionsStore().fetchSessions(undefined, undefined, undefined, {
          silent,
        }),
    };

  async function refreshCurrentRoute(silent = true): Promise<boolean> {
    const routeName = router.currentRoute.value.name as string | undefined;
    if (!routeName) return false;

    const refresh = routeRefreshMap[routeName];
    if (!refresh) return false;

    refreshing.value = true;
    try {
      const ok = await refresh(silent);
      if (ok) {
        const ts = new Date();
        lastDataUpdatedAt.value = ts;
        lastUpdatedAt.value = ts;
        hasNewData.value = false;
      }
      return ok;
    } finally {
      refreshing.value = false;
    }
  }

  // ── Refresh Scheduling ─────────────────────────────────────────────

  function scheduleSseRefresh(): void {
    clearSseRefreshTimer();
    sseRefreshTimer = setTimeout(() => {
      sseRefreshTimer = null;
      void runScheduledRefresh();
    }, SSE_REFRESH_WAIT_MS);
  }

  async function runScheduledRefresh(): Promise<void> {
    await refreshCurrentRoute(true);
    restartFallbackPolling();
  }

  function cancelDebouncedRefresh(): void {
    clearSseRefreshTimer();
  }

  function clearSseRefreshTimer(): void {
    if (sseRefreshTimer !== null) {
      clearTimeout(sseRefreshTimer);
      sseRefreshTimer = null;
    }
  }

  function startFallbackPolling(): void {
    stopFallbackPolling();
    isFallbackPolling.value = true;
    fallbackRefreshTimer = setInterval(() => {
      void refreshCurrentRoute(true);
    }, FALLBACK_REFRESH_INTERVAL_MS);
  }

  function stopFallbackPolling(): void {
    if (fallbackRefreshTimer !== null) {
      clearInterval(fallbackRefreshTimer);
      fallbackRefreshTimer = null;
    }
    isFallbackPolling.value = false;
  }

  function restartFallbackPolling(): void {
    if (fallbackRefreshTimer !== null) {
      startFallbackPolling();
    }
  }

  // ── SSE Callbacks ──────────────────────────────────────────────────

  function handleNotification(): void {
    realtimeMode.value = "sse";
    scheduleSseRefresh();
  }

  function handleOpen(): void {
    // A reconnect can miss invalidation frames; refresh once from REST, which is the source of truth.
    void runScheduledRefresh();
  }

  // ── Reactive State ─────────────────────────────────────────────────

  const realtimeMode = ref<RealtimeMode>("disconnected") as Ref<RealtimeMode>;
  const initialUpdatedAt = new Date();
  const lastUpdatedAt = ref<Date | null>(initialUpdatedAt) as Ref<Date | null>;
  const lastDataUpdatedAt = ref<Date | null>(
    initialUpdatedAt,
  ) as Ref<Date | null>;
  const refreshing = ref(false) as Ref<boolean>;

  const connectionState = ref<
    "disconnected" | "reconnecting" | "connecting" | "connected"
  >("disconnected");
  const lastSyncTime = ref<Date | null>(null) as Ref<Date | null>;
  const hasNewData = ref(false) as Ref<boolean>;
  const reconnectInterval = ref(RECONNECT_BASE_INTERVAL) as Ref<number>;
  const reconnectAttempts = ref(0) as Ref<number>;
  const isFallbackPolling = ref(false) as Ref<boolean>;

  // ── Internal State ─────────────────────────────────────────────────

  let eventSource: EventSource | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let sseRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  let fallbackRefreshTimer: ReturnType<typeof setInterval> | null = null;
  let intentionalClose = false;
  let pendingReconnect = false;

  // ── Derived State ─────────────────────────────────────────────────

  const statusDot = computed<StatusDot>(() => {
    if (
      connectionState.value === "disconnected" ||
      connectionState.value === "reconnecting"
    ) {
      return "red";
    }
    if (hasNewData.value) {
      return "yellow";
    }
    return "green";
  });

  const statusLabel = computed<string>(() => {
    switch (connectionState.value) {
      case "disconnected":
        return "连接断开";
      case "reconnecting":
        return "正在重连";
      case "connecting":
        return "连接中";
      case "connected":
        return hasNewData.value ? "有新数据" : "数据已同步";
    }
  });

  // ── Message Handler ────────────────────────────────────────────────

  function handleMessage(event: MessageEvent): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(event.data);
    } catch {
      return;
    }

    if (!isStatsNotification(parsed)) {
      return;
    }

    hasNewData.value = true;
    lastSyncTime.value = new Date();

    handleNotification();
  }

  // ── Reconnect Logic ────────────────────────────────────────────────

  function scheduleReconnect(): void {
    if (intentionalClose) return;

    reconnectAttempts.value++;

    if (reconnectAttempts.value >= MAX_RECONNECT_ATTEMPTS) {
      connectionState.value = "disconnected";
      realtimeMode.value = "polling";
      startFallbackPolling();
      return;
    }

    pendingReconnect = true;
    connectionState.value = "reconnecting";
    realtimeMode.value = "polling";
    clearReconnectTimer();

    const backoffInterval = Math.min(
      RECONNECT_BASE_INTERVAL * 2 ** (reconnectAttempts.value - 1),
      RECONNECT_MAX_INTERVAL,
    );
    reconnectInterval.value = backoffInterval;

    reconnectTimer = setTimeout(() => {
      if (!intentionalClose) {
        doConnect();
      }
    }, backoffInterval);
  }

  function clearReconnectTimer(): void {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  // ── Connection Lifecycle ───────────────────────────────────────────

  function doConnect(): void {
    if (
      eventSource &&
      connectionState.value !== "disconnected" &&
      connectionState.value !== "reconnecting"
    ) {
      return;
    }

    closeEventSource();

    connectionState.value = "connecting";
    intentionalClose = false;

    try {
      eventSource = connectSSE();

      eventSource.addEventListener(
        SSE_EVENT_NAME,
        handleMessage as EventListener,
      );

      eventSource.addEventListener("open", () => {
        const isReconnect = pendingReconnect;
        pendingReconnect = false;
        connectionState.value = "connected";
        realtimeMode.value = "sse";
        reconnectAttempts.value = 0;
        reconnectInterval.value = RECONNECT_BASE_INTERVAL;
        startFallbackPolling();
        if (isReconnect) {
          handleOpen();
        }
      });

      eventSource.onerror = () => {
        closeEventSource();
        scheduleReconnect();
      };
    } catch {
      connectionState.value = "disconnected";
      scheduleReconnect();
    }
  }

  function closeEventSource(): void {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
  }

  // ── Public API ─────────────────────────────────────────────────────

  function connect(): void {
    intentionalClose = false;
    pendingReconnect = false;
    reconnectAttempts.value = 0;
    reconnectInterval.value = RECONNECT_BASE_INTERVAL;
    realtimeMode.value = "sse";
    startFallbackPolling();
    doConnect();
  }

  function disconnect(): void {
    intentionalClose = true;
    clearReconnectTimer();
    cancelDebouncedRefresh();
    stopFallbackPolling();
    closeEventSource();
    connectionState.value = "disconnected";
    realtimeMode.value = "disconnected";
  }

  function reconnect(): void {
    intentionalClose = false;
    pendingReconnect = true;
    clearReconnectTimer();
    cancelDebouncedRefresh();
    closeEventSource();
    reconnectAttempts.value = 0;
    reconnectInterval.value = RECONNECT_BASE_INTERVAL;
    connectionState.value = "disconnected";
    realtimeMode.value = "sse";
    startFallbackPolling();
    doConnect();
  }

  function markSynced(): void {
    hasNewData.value = false;
    lastSyncTime.value = new Date();
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
    realtimeMode,
    lastUpdatedAt,
    lastDataUpdatedAt,
    refreshing,
    connect,
    disconnect,
    reconnect,
    markSynced,
    refreshCurrentRoute,
    cancelDebouncedRefresh,
  };
}
