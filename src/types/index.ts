/**
 * Type definitions barrel export for the Event-Sourced Stats Engine.
 *
 * Re-exports all types from submodules for convenient importing.
 */

// Event types
export type {
  EventType,
  TokenBreakdown,
  ToolStatus,
  PermissionResponse,
  SessionStatus,
  AgentRole,
  SessionCreatedContents,
  SessionUpdatedContents,
  SessionDeletedContents,
  SessionErrorContents,
  SessionDiffContents,
  MessageCreatedContents,
  MessageUpdatedContents,
  MessageDeletedContents,
  ToolStartedContents,
  ToolCompletedContents,
  ToolFailedContents,
  ToolExecuteBeforeContents,
  ToolExecuteAfterContents,
  FileCreatedContents,
  FileEditedContents,
  FileDeletedContents,
  PermissionCreatedContents,
  PermissionUpdatedContents,
  PermissionResolvedContents,
  UsageUpdatedContents,
  AgentStartedContents,
  AgentCompletedContents,
  AgentFailedContents,
  ProviderConnectedContents,
  ProviderDisconnectedContents,
  ProviderErrorContents,
  ConfigUpdatedContents,
  ProjectCreatedContents,
  ProjectDeletedContents,
  SystemStartedContents,
  EventContents,
  IngestEventEnvelope,
} from "./events.js"

export {
  isSessionCreatedContents,
  isSessionUpdatedContents,
  isSessionDeletedContents,
  isSessionErrorContents,
  isSessionDiffContents,
  isMessageCreatedContents,
  isMessageUpdatedContents,
  isMessageDeletedContents,
  isToolStartedContents,
  isToolCompletedContents,
  isToolFailedContents,
  isToolExecuteBeforeContents,
  isToolExecuteAfterContents,
  isFileCreatedContents,
  isFileEditedContents,
  isFileDeletedContents,
  isPermissionCreatedContents,
  isPermissionUpdatedContents,
  isPermissionResolvedContents,
  isUsageUpdatedContents,
  isAgentStartedContents,
  isAgentCompletedContents,
  isAgentFailedContents,
  isProviderConnectedContents,
  isProviderDisconnectedContents,
  isProviderErrorContents,
  isConfigUpdatedContents,
  isProjectCreatedContents,
  isProjectDeletedContents,
  isSystemStartedContents,
  FORBIDDEN_METADATA_KEYS,
} from "./events.js"

// Projection types
export type {
  ModelUsageEntry,
  ModelUsage,
  AgentUsageEntry,
  AgentUsage,
  ProjectionSession,
  ProjectionDaily,
  ToolCallStatus,
  ProjectionToolCall,
  DailyAggregateByModel,
  DailyAggregateTokens,
  DailyAggregateCost,
  DailyAggregateTools,
  DailyAggregateFiles,
  DailyAggregateAgents,
  DailyAggregateErrors,
  DailyAggregateSessions,
  DailyAggregateMessages,
} from "./projections.js"

// Snapshot types
export type {
  SnapshotType,
  SessionSnapshotData,
  DailySnapshotData,
  WeeklySnapshotData,
  MonthlySnapshotData,
  SnapshotData,
  SnapshotRecord,
} from "./snapshots.js"

export {
  generateSessionSnapshotId,
  generateDailySnapshotId,
  generateWeeklySnapshotId,
  generateMonthlySnapshotId,
  isSessionSnapshotData,
  isDailySnapshotData,
  isWeeklySnapshotData,
  isMonthlySnapshotData,
} from "./snapshots.js"

// API types
export type {
  TimeRange,
  SortOrder,
  GroupByDimension,
  PaginationParams,
  ApiResponse,
  ApiError,
  StatsQuery,
  OverviewStats,
  TrendDataPoint,
  TrendResponse,
  SessionListItem,
  SessionDetail,
  SessionsListResponse,
  ToolStatsItem,
  ToolsStatsResponse,
  ModelComparisonItem,
  ModelsComparisonResponse,
  ProjectStatsItem,
  ProjectsStatsResponse,
  ErrorStatsItem,
  ErrorsStatsResponse,
  IngestRequest,
  IngestResponse,
} from "./api.js"

// SSE types
export type {
  SSEEventType,
  SSEAction,
  SSEDelta,
  StatsUpdate,
  SSEFrame,
  SSEConnectionState,
  SSEClientInfo,
} from "./sse.js"

export {
  isStatsUpdate,
  isSSEDelta,
  SSE_EVENT_NAME,
  SSE_KEEPALIVE,
} from "./sse.js"
