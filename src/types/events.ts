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
// Event Contents Interfaces (only used ones)
// ============================================================================

export interface SessionCreatedContents {
  project_path: string;
  title: string;
  version?: string;
}

export interface SessionDeletedContents {
  summary?: {
    total_messages?: number;
    total_tokens?: number;
    total_cost_usd?: number;
    duration_ms?: number;
  };
}

export interface SessionErrorContents {
  error_type: string;
  error_message: string;
  stack_trace?: string;
}

export interface SessionDiffContents {
  files_changed: number;
  lines_added: number;
  lines_deleted: number;
  files?: Array<{
    path: string;
    additions: number;
    deletions: number;
  }>;
}

export interface MessageUpdatedContents {
  message_id: string;
  role: AgentRole;
  tokens?: TokenBreakdown;
  cost_usd?: number;
  content_preview?: string;
}

export interface ToolCompletedContents {
  tool_name: string;
  call_id: string;
  title?: string;
  duration_ms?: number;
  tokens?: TokenBreakdown;
  cost_usd?: number;
}

export interface ToolFailedContents {
  tool_name: string;
  call_id: string;
  error_message: string;
  duration_ms?: number;
}

export interface FileEditedContents {
  file_path: string;
  additions: number;
  deletions: number;
}

export interface AgentCompletedContents {
  agent_name: string;
  duration_ms?: number;
  tokens?: TokenBreakdown;
  cost_usd?: number;
}

// ============================================================================
// Event Contents Union
// ============================================================================

export type EventContents =
  | SessionCreatedContents
  | SessionDeletedContents
  | SessionErrorContents
  | SessionDiffContents
  | MessageUpdatedContents
  | ToolCompletedContents
  | ToolFailedContents
  | FileEditedContents
  | AgentCompletedContents;

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
// Type Guards (only for used types)
// ============================================================================

/** Type guard for SessionCreatedContents */
export function isSessionCreatedContents(
  data: unknown,
): data is SessionCreatedContents {
  return (
    typeof data === "object" &&
    data !== null &&
    "project_path" in data &&
    "title" in data &&
    typeof (data as SessionCreatedContents).project_path === "string" &&
    typeof (data as SessionCreatedContents).title === "string"
  );
}

/** Type guard for SessionDeletedContents */
export function isSessionDeletedContents(
  data: unknown,
): data is SessionDeletedContents {
  return typeof data === "object" && data !== null;
}

/** Type guard for SessionErrorContents */
export function isSessionErrorContents(
  data: unknown,
): data is SessionErrorContents {
  return (
    typeof data === "object" &&
    data !== null &&
    "error_type" in data &&
    "error_message" in data &&
    typeof (data as SessionErrorContents).error_type === "string" &&
    typeof (data as SessionErrorContents).error_message === "string"
  );
}

/** Type guard for SessionDiffContents */
export function isSessionDiffContents(
  data: unknown,
): data is SessionDiffContents {
  return (
    typeof data === "object" &&
    data !== null &&
    "files_changed" in data &&
    "lines_added" in data &&
    "lines_deleted" in data &&
    typeof (data as SessionDiffContents).files_changed === "number" &&
    typeof (data as SessionDiffContents).lines_added === "number" &&
    typeof (data as SessionDiffContents).lines_deleted === "number"
  );
}

/** Type guard for MessageUpdatedContents */
export function isMessageUpdatedContents(
  data: unknown,
): data is MessageUpdatedContents {
  return (
    typeof data === "object" &&
    data !== null &&
    "message_id" in data &&
    "role" in data &&
    typeof (data as MessageUpdatedContents).message_id === "string" &&
    typeof (data as MessageUpdatedContents).role === "string"
  );
}

/** Type guard for ToolCompletedContents */
export function isToolCompletedContents(
  data: unknown,
): data is ToolCompletedContents {
  return (
    typeof data === "object" &&
    data !== null &&
    "tool_name" in data &&
    "call_id" in data &&
    typeof (data as ToolCompletedContents).tool_name === "string" &&
    typeof (data as ToolCompletedContents).call_id === "string"
  );
}

/** Type guard for ToolFailedContents */
export function isToolFailedContents(
  data: unknown,
): data is ToolFailedContents {
  return (
    typeof data === "object" &&
    data !== null &&
    "tool_name" in data &&
    "call_id" in data &&
    "error_message" in data &&
    typeof (data as ToolFailedContents).tool_name === "string" &&
    typeof (data as ToolFailedContents).call_id === "string" &&
    typeof (data as ToolFailedContents).error_message === "string"
  );
}

/** Type guard for FileEditedContents */
export function isFileEditedContents(
  data: unknown,
): data is FileEditedContents {
  return (
    typeof data === "object" &&
    data !== null &&
    "file_path" in data &&
    "additions" in data &&
    "deletions" in data &&
    typeof (data as FileEditedContents).file_path === "string" &&
    typeof (data as FileEditedContents).additions === "number" &&
    typeof (data as FileEditedContents).deletions === "number"
  );
}

/** Type guard for AgentCompletedContents */
export function isAgentCompletedContents(
  data: unknown,
): data is AgentCompletedContents {
  return (
    typeof data === "object" &&
    data !== null &&
    "agent_name" in data &&
    typeof (data as AgentCompletedContents).agent_name === "string"
  );
}

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
