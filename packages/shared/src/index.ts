/**
 * @opencode-stats/shared — Shared types, constants, and utilities
 *
 * This barrel re-exports the public surface needed by both the engine
 * backend and the Vue dashboard.
 */

// ── API response types ──────────────────────────────────────────────────────
export type {
  DashboardDataResponse,
  DashboardEfficiencyData,
  DashboardEfficiencyHeatmapPoint,
  DashboardEfficiencySummary,
  DashboardEfficiencyTimelinePoint,
  DashboardModelCostTrendPoint,
  DashboardModelItem,
  DashboardModelsData,
  DashboardOverviewData,
  DashboardOverviewProjectDistributionItem,
  DashboardOverviewSummary,
  DashboardOverviewTopModel,
  DashboardOverviewTrendPoint,
  DashboardProjectActivityTrendPoint,
  DashboardProjectItem,
  DashboardProjectModelUsageItem,
  DashboardProjectsData,
  DashboardSessionDetailData,
  DashboardSessionDetailSummary,
  DashboardSessionError,
  DashboardSessionListItem,
  DashboardSessionMessageMetadata,
  DashboardSessionModelUsage,
  DashboardSessionToolCall,
  DashboardToolItem,
  DashboardToolRecentError,
  DashboardToolsData,
  DashboardToolsSummary,
  DashboardToolTimelinePoint,
  RouteRegistrar,
  SortOrder,
} from "./types/api";
// ── Event types & constants ─────────────────────────────────────────────────
export type {
  BaseStatsEvent,
  MessageUpdatedAssistantEvent,
  MessageUpdatedUserEvent,
  SessionCreatedEvent,
  SessionDeletedEvent,
  SessionErrorEvent,
  SessionUpdatedEvent,
  StatsEvent,
  StatsEventType,
  TokenBreakdown,
  ToolExecuteCompletedEvent,
  ToolExecuteFailedEvent,
  ToolExecutePendingEvent,
  ToolExecuteRunningEvent,
} from "./types/events";
export { FORBIDDEN_METADATA_KEYS } from "./types/events";

// ── Projection types ────────────────────────────────────────────────────────
export type {
  ProjectionHandler,
  TransactionContext,
} from "./types/projections";

// ── Stream types, guards & constants ────────────────────────────────────────
export type {
  SSEClientInfo,
  SSEConnectionState,
  SSEFrame,
  StatsNotification,
} from "./types/stream";

export {
  isStatsNotification,
  SSE_EVENT_NAME,
  SSE_KEEPALIVE,
} from "./types/stream";

// ── Event utilities ─────────────────────────────────────────────────────────
export {
  createBaseEvent,
  defaultTokens,
  normalizeTokens,
} from "./utils/event";

// ── Projection utilities ────────────────────────────────────────────────────
export { totalTokens } from "./utils/projection";
