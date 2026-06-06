/**
 * Event type definitions for the Event-Sourced Stats Engine.
 *
 * Covers the 9 event types actually used by the stats plugin:
 * session.created, session.deleted, session.error, session.diff,
 * message.updated, tool.completed, tool.failed, file.edited, agent.completed
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

/** Agent role */
export type AgentRole = "user" | "assistant" | "system";

// ============================================================================
// Event Type Union (9 types actually used)
// ============================================================================

export type EventType =
  | "session.created"
  | "session.deleted"
  | "session.error"
  | "session.diff"
  | "message.updated"
  | "tool.completed"
  | "tool.failed"
  | "file.edited"
  | "agent.completed";

// ============================================================================
// Tool Event Input/Output Types
// ============================================================================

/** Input from tool.execute.after hook */
export interface ToolEventInput {
  tool: string;
  sessionID: string;
  callID: string;
  args: unknown;
}

/** Output from tool.execute.after hook */
export interface ToolEventOutput {
  title: string;
  output: string;
  metadata: Record<string, unknown>;
}

// ============================================================================
// Stats Event Types
// ============================================================================

/** Common fields shared by all stats events */
export interface BaseStatsEvent {
  /** Unique event identifier — idempotency key for deduplication */
  event_id: string;
  /** Event timestamp in milliseconds since epoch */
  timestamp_ms: number;
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

/** Tool execution completed */
export interface ToolCompletedEvent extends BaseStatsEvent {
  event_type: "tool.completed";
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
  /** ← output.metadata.tokens */
  tokens?: TokenBreakdown;
  /** ← output.metadata.cost_usd ?? 0 */
  cost_usd: number;
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

/** Agent completed */
export interface AgentCompletedEvent extends BaseStatsEvent {
  event_type: "agent.completed";
  /** ← event.properties.sessionID */
  session_id: string;
  /** ← input.directory */
  project_path: string;
  /** ← event.properties.agent.name */
  agent_name: string;
  /** ← event.properties.tokens */
  tokens: TokenBreakdown;
  /** ← event.properties.cost_usd ?? 0 */
  cost_usd: number;
}

/** Union of all stats event types */
export type StatsEvent =
  | SessionCreatedEvent
  | SessionDeletedEvent
  | SessionErrorEvent
  | SessionDiffEvent
  | MessageUpdatedEvent
  | ToolCompletedEvent
  | ToolFailedEvent
  | FileEditedEvent
  | AgentCompletedEvent;

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
