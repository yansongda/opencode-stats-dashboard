/**
 * Event type definitions for the Event-Sourced Stats Engine.
 *
 * Each event maps 1:1 to an upstream opencode SDK event. We deliberately
 * do NOT synthesize derived events; every StatsEvent must trace back to a
 * concrete SDK Event delivered via a plugin hook.
 *
 * Covers 7 event types:
 *   session.created, session.updated, session.deleted, session.error,
 *   message.updated, tool.execute.after, tool.failed
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
// Event Type Union (7 types, each maps 1:1 to an SDK event)
// ============================================================================

export type EventType =
  | "session.created"
  | "session.updated"
  | "session.deleted"
  | "session.error"
  | "message.updated"
  | "tool.execute.after"
  | "tool.failed";

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

/** Message updated (tokens/cost finalized) */
export interface MessageUpdatedEvent extends BaseStatsEvent {
  event_type: "message.updated";
  /** ← event.properties.info.id */
  message_id: string;
  /** ← event.properties.info.sessionID */
  session_id: string;
  /** ← input.directory */
  project_path: string;
  /** ← `${info.providerID}/${info.modelID}` */
  model: string;
  /** ← event.properties.info.role */
  role: string;
  /** ← event.properties.info.agent (user) || event.properties.info.mode (assistant) */
  agent?: string;
  /** ← event.properties.info.tokens */
  tokens: TokenBreakdown;
  /** ← event.properties.info.cost ?? 0 */
  cost_usd: number;
  /** ← event.properties.info.summary?.diffs.reduce(sum => sum.additions) */
  lines_added: number;
  /** ← event.properties.info.summary?.diffs.reduce(sum => sum.deletions) */
  lines_deleted: number;
  /** ← event.properties.info.summary?.diffs.length */
  files_changed: number;
  /** ← event.properties.info.time.created */
  created_at_ms: number;
  /** ← event.properties.info.time.completed (assistant messages) */
  completed_at_ms?: number;
  /** ← completed_at_ms - created_at_ms */
  duration_ms?: number;
  /** ← event.properties.info.finish (assistant messages) */
  finish_reason?: string;
  /** ← event.properties.info.error ? 1 : 0 */
  has_error: number;
  /** ← event.properties.info.error?.name */
  error_type?: string;
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

/** Union of all stats event types */
export type StatsEvent =
  | SessionCreatedEvent
  | SessionUpdatedEvent
  | SessionDeletedEvent
  | SessionErrorEvent
  | MessageUpdatedEvent
  | ToolExecuteBeforeEvent
  | ToolExecuteAfterEvent
  | ToolFailedEvent;

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
