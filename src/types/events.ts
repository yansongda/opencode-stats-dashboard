/**
 * Event type definitions for the Event-Sourced Stats Engine.
 *
 * Each event maps 1:1 to an upstream opencode SDK event. We deliberately
 * do NOT synthesize derived events; every StatsEvent must trace back to a
 * concrete SDK Event delivered via a plugin hook.
 *
 * Covers 9 event types:
 *   session.created, session.updated, session.deleted, session.error,
 *   session.diff, message.updated, tool.completed, tool.failed, file.edited
 */

// ============================================================================
// Base Types
// ============================================================================

/** Token breakdown structure used across multiple event types */
export interface TokenBreakdown {
  input: number;
  output: number;
  reasoning: number;
  cache: {
    read: number;
    write: number;
  };
}

/** Tool execution status */
export type ToolStatus = "started" | "completed" | "failed";

/** Session status */
export type SessionStatus = "active" | "deleted";

// ============================================================================
// Event Type Union (9 types, each maps 1:1 to an SDK event)
// ============================================================================

export type EventType =
  | "session.created"
  | "session.updated"
  | "session.deleted"
  | "session.error"
  | "session.diff"
  | "message.updated"
  | "tool.execute.after"
  | "tool.failed"
  | "file.edited";

// ============================================================================
// Stats Event Types
// ============================================================================

/** Common fields shared by all stats events */
export interface BaseStatsEvent {
  /** Unique event identifier — idempotency key for deduplication */
  event_id: string;
  /** Event timestamp in milliseconds since epoch */
  created_at_ms: number;
}

/** Session created */
export interface SessionCreatedEvent extends BaseStatsEvent {
  event_type: "session.created";
  /** ← event.properties.info.id */
  session_id: string;
  /** ← event.properties.info.directory || input.directory */
  project_path: string;
  /** ← event.properties.info.title ?? "" */
  title: string;
}

/** Session updated (title change, etc.) */
export interface SessionUpdatedEvent extends BaseStatsEvent {
  event_type: "session.updated";
  /** ← event.properties.info.id */
  session_id: string;
  /** ← event.properties.info.directory || input.directory */
  project_path: string;
  /** ← event.properties.info.title */
  title: string;
}

/** Session deleted */
export interface SessionDeletedEvent extends BaseStatsEvent {
  event_type: "session.deleted";
  /** ← event.properties.info.id */
  session_id: string;
  /** ← event.properties.info.directory || input.directory */
  project_path: string;
}

/** Session error */
export interface SessionErrorEvent extends BaseStatsEvent {
  event_type: "session.error";
  /** ← event.properties.sessionID */
  session_id: string;
  /** ← input.directory */
  project_path: string;
  /** ← event.properties.error.name */
  error_type: string;
  /** ← event.properties.error.data.message */
  error_message: string;
}

/** Session diff (git diff stats) */
export interface SessionDiffEvent extends BaseStatsEvent {
  event_type: "session.diff";
  /** ← event.properties.sessionID */
  session_id: string;
  /** ← input.directory */
  project_path: string;
  /** ← event.properties.diff.reduce(sum => sum.additions) */
  lines_added: number;
  /** ← event.properties.diff.reduce(sum => sum.deletions) */
  lines_deleted: number;
  /** ← event.properties.diff.length */
  files_changed: number;
}

/** Message updated (tokens/cost finalized) */
export interface MessageUpdatedEvent extends BaseStatsEvent {
  event_type: "message.updated";
  /** ← event.properties.info.sessionID */
  session_id: string;
  /** ← input.directory */
  project_path: string;
  /** ← `${info.providerID}/${info.modelID}` */
  model: string;
  /** ← event.properties.info.role */
  role: string;
  /** ← event.properties.info.tokens */
  tokens: TokenBreakdown;
  /** ← event.properties.info.cost ?? 0 */
  cost_usd: number;
}

/** Tool execution started (from tool.execute.before hook) */
export interface ToolExecuteBeforeEvent extends BaseStatsEvent {
  event_type: "tool.execute.before";
  /** ← input.sessionID */
  session_id: string;
  /** ← ctx.directory */
  project_path: string;
  /** ← input.tool */
  tool_name: string;
  /** ← input.callID */
  call_id: string;
}

/** Tool execution completed (from tool.execute.after hook) */
export interface ToolExecuteAfterEvent extends BaseStatsEvent {
  event_type: "tool.execute.after";
  /** ← input.sessionID */
  session_id: string;
  /** ← ctx.directory */
  project_path: string;
  /** ← input.tool */
  tool_name: string;
  /** ← input.callID */
  call_id: string;
  /** ← output.metadata.duration_ms ?? 0 */
  duration_ms: number;
  /** ← output.title */
  title: string;
}

/** Tool execution failed */
export interface ToolFailedEvent extends BaseStatsEvent {
  event_type: "tool.failed";
  /** ← input.sessionID */
  session_id: string;
  /** ← ctx.directory */
  project_path: string;
  /** ← input.tool */
  tool_name: string;
  /** ← input.callID */
  call_id: string;
  /** ← output.metadata.duration_ms ?? 0 */
  duration_ms: number;
  /** ← output.metadata.error_message */
  error_message: string;
}

/** File edited */
export interface FileEditedEvent extends BaseStatsEvent {
  event_type: "file.edited";
  /** ← input.directory */
  project_path: string;
  /** ← event.properties.file */
  file_path: string;
}

/** Union of all stats event types */
export type StatsEvent =
  | SessionCreatedEvent
  | SessionUpdatedEvent
  | SessionDeletedEvent
  | SessionErrorEvent
  | SessionDiffEvent
  | MessageUpdatedEvent
  | ToolExecuteBeforeEvent
  | ToolExecuteAfterEvent
  | ToolFailedEvent
  | FileEditedEvent;

/** Extracted union of all event_type literal values */
export type StatsEventType = StatsEvent["event_type"];

// ============================================================================
// Constants
// ============================================================================

/**
 * Privacy-sensitive fields that must NEVER appear in metadata.
 * Fixture validation enforces this constraint.
 */
export const FORBIDDEN_METADATA_KEYS = [
  "tool_input",
  "tool_output",
  "message_body",
  "raw_input",
  "raw_output",
] as const;
