/**
 * Event type definitions for the Event-Sourced Stats Engine.
 *
 * 30 event types covering session lifecycle, messages, tools, files,
 * permissions, agents, providers, and system events.
 */

// ============================================================================
// Base Types
// ============================================================================

/** Token breakdown structure used across multiple event types */
export interface TokenBreakdown {
  input: number
  output: number
  reasoning: number
  cache: {
    read: number
    write: number
  }
}

/** Tool execution status */
export type ToolStatus = "started" | "completed" | "failed"

/** Permission response */
export type PermissionResponse = "allow" | "deny" | "ask"

/** Session status */
export type SessionStatus = "active" | "deleted"

/** Agent role */
export type AgentRole = "user" | "assistant" | "system"

// ============================================================================
// Event Type Union (30 types)
// ============================================================================

export type EventType =
  // Session events (5)
  | "session.created"
  | "session.updated"
  | "session.deleted"
  | "session.error"
  | "session.diff"
  // Message events (3)
  | "message.created"
  | "message.updated"
  | "message.deleted"
  // Tool events (5)
  | "tool.started"
  | "tool.completed"
  | "tool.failed"
  | "tool.execute.before"
  | "tool.execute.after"
  // File events (3)
  | "file.created"
  | "file.edited"
  | "file.deleted"
  // Permission events (3)
  | "permission.created"
  | "permission.updated"
  | "permission.resolved"
  // Usage events (1)
  | "usage.updated"
  // Agent events (3)
  | "agent.started"
  | "agent.completed"
  | "agent.failed"
  // Provider events (3)
  | "provider.connected"
  | "provider.disconnected"
  | "provider.error"
  // Config events (1)
  | "config.updated"
  // Project events (2)
  | "project.created"
  | "project.deleted"
  // System events (1)
  | "system.started"

// ============================================================================
// Event Contents Interfaces
// ============================================================================

// --- Session Events ---

export interface SessionCreatedContents {
  project_path: string
  title: string
  version?: string
}

export interface SessionUpdatedContents {
  title?: string
  project_path?: string
}

export interface SessionDeletedContents {
  summary?: {
    total_messages?: number
    total_tokens?: number
    total_cost_usd?: number
    duration_ms?: number
  }
}

export interface SessionErrorContents {
  error_type: string
  error_message: string
  stack_trace?: string
}

export interface SessionDiffContents {
  files_changed: number
  lines_added: number
  lines_deleted: number
  files?: Array<{
    path: string
    additions: number
    deletions: number
  }>
}

// --- Message Events ---

export interface MessageCreatedContents {
  message_id: string
  role: AgentRole
  content_preview?: string
}

export interface MessageUpdatedContents {
  message_id: string
  role: AgentRole
  tokens?: TokenBreakdown
  cost_usd?: number
  content_preview?: string
}

export interface MessageDeletedContents {
  message_id: string
}

// --- Tool Events ---

export interface ToolStartedContents {
  tool_name: string
  call_id: string
  title?: string
}

export interface ToolCompletedContents {
  tool_name: string
  call_id: string
  title?: string
  duration_ms?: number
  tokens?: TokenBreakdown
  cost_usd?: number
}

export interface ToolFailedContents {
  tool_name: string
  call_id: string
  error_message: string
  duration_ms?: number
}

export interface ToolExecuteBeforeContents {
  tool_name: string
  call_id: string
}

export interface ToolExecuteAfterContents {
  tool_name: string
  call_id: string
  status: "completed" | "error"
  title?: string
  duration_ms?: number
  tokens?: TokenBreakdown
  cost_usd?: number
}

// --- File Events ---

export interface FileCreatedContents {
  file_path: string
}

export interface FileEditedContents {
  file_path: string
  additions: number
  deletions: number
}

export interface FileDeletedContents {
  file_path: string
}

// --- Permission Events ---

export interface PermissionCreatedContents {
  permission_id: string
  permission_type: string
  pattern: string
}

export interface PermissionUpdatedContents {
  permission_id: string
  permission_type: string
  pattern: string
}

export interface PermissionResolvedContents {
  permission_id: string
  permission_type: string
  pattern: string
  response: PermissionResponse
}

// --- Usage Events ---

export interface UsageUpdatedContents {
  tokens: TokenBreakdown
  cost_usd: number
}

// --- Agent Events ---

export interface AgentStartedContents {
  agent_name: string
  task_description?: string
}

export interface AgentCompletedContents {
  agent_name: string
  duration_ms?: number
  tokens?: TokenBreakdown
  cost_usd?: number
}

export interface AgentFailedContents {
  agent_name: string
  error_message: string
}

// --- Provider Events ---

export interface ProviderConnectedContents {
  provider_name: string
  model?: string
}

export interface ProviderDisconnectedContents {
  provider_name: string
  reason?: string
}

export interface ProviderErrorContents {
  provider_name: string
  error_type: string
  error_message: string
}

// --- Config Events ---

export interface ConfigUpdatedContents {
  config_path: string
  changes?: string[]
}

// --- Project Events ---

export interface ProjectCreatedContents {
  project_path: string
  name?: string
}

export interface ProjectDeletedContents {
  project_path: string
}

// --- System Events ---

export interface SystemStartedContents {
  version?: string
  uptime_ms?: number
}

// ============================================================================
// Event Contents Union
// ============================================================================

export type EventContents =
  | SessionCreatedContents
  | SessionUpdatedContents
  | SessionDeletedContents
  | SessionErrorContents
  | SessionDiffContents
  | MessageCreatedContents
  | MessageUpdatedContents
  | MessageDeletedContents
  | ToolStartedContents
  | ToolCompletedContents
  | ToolFailedContents
  | ToolExecuteBeforeContents
  | ToolExecuteAfterContents
  | FileCreatedContents
  | FileEditedContents
  | FileDeletedContents
  | PermissionCreatedContents
  | PermissionUpdatedContents
  | PermissionResolvedContents
  | UsageUpdatedContents
  | AgentStartedContents
  | AgentCompletedContents
  | AgentFailedContents
  | ProviderConnectedContents
  | ProviderDisconnectedContents
  | ProviderErrorContents
  | ConfigUpdatedContents
  | ProjectCreatedContents
  | ProjectDeletedContents
  | SystemStartedContents

// ============================================================================
// Ingest Event Envelope
// ============================================================================

export interface IngestEventEnvelope {
  /** UUID v4 — idempotency key for deduplication */
  event_id: string
  /** Discriminator for event routing */
  event_type: EventType
  /** OpenCode session identifier */
  session_id: string
  /** Absolute path to the project directory */
  project_path: string
  /** Event timestamp in milliseconds since epoch */
  timestamp_ms: number
  /** Model identifier (e.g. "claude-sonnet-4-20250514") */
  model: string
  /** Token count associated with this event */
  tokens: number
  /** Cost in USD associated with this event */
  cost_usd: number
  /** Tool name — present only for tool events */
  tool: string | null
  /** Tool execution status — present only for tool events */
  status: ToolStatus | null
  /** Short human-readable summary (redacted, no full payloads) */
  summary: string | null
  /** Whether the session is deleted */
  deleted: boolean
  /** Redacted metadata — no full tool inputs/outputs allowed */
  metadata: Record<string, unknown>
}

// ============================================================================
// Type Guards
// ============================================================================

/** Type guard for SessionCreatedContents */
export function isSessionCreatedContents(
  data: unknown
): data is SessionCreatedContents {
  return (
    typeof data === "object" &&
    data !== null &&
    "project_path" in data &&
    "title" in data &&
    typeof (data as SessionCreatedContents).project_path === "string" &&
    typeof (data as SessionCreatedContents).title === "string"
  )
}

/** Type guard for SessionUpdatedContents */
export function isSessionUpdatedContents(
  data: unknown
): data is SessionUpdatedContents {
  return (
    typeof data === "object" && data !== null && ("title" in data || "project_path" in data)
  )
}

/** Type guard for SessionDeletedContents */
export function isSessionDeletedContents(
  data: unknown
): data is SessionDeletedContents {
  return typeof data === "object" && data !== null
}

/** Type guard for SessionErrorContents */
export function isSessionErrorContents(
  data: unknown
): data is SessionErrorContents {
  return (
    typeof data === "object" &&
    data !== null &&
    "error_type" in data &&
    "error_message" in data &&
    typeof (data as SessionErrorContents).error_type === "string" &&
    typeof (data as SessionErrorContents).error_message === "string"
  )
}

/** Type guard for SessionDiffContents */
export function isSessionDiffContents(
  data: unknown
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
  )
}

/** Type guard for MessageCreatedContents */
export function isMessageCreatedContents(
  data: unknown
): data is MessageCreatedContents {
  return (
    typeof data === "object" &&
    data !== null &&
    "message_id" in data &&
    "role" in data &&
    typeof (data as MessageCreatedContents).message_id === "string" &&
    typeof (data as MessageCreatedContents).role === "string"
  )
}

/** Type guard for MessageUpdatedContents */
export function isMessageUpdatedContents(
  data: unknown
): data is MessageUpdatedContents {
  return (
    typeof data === "object" &&
    data !== null &&
    "message_id" in data &&
    "role" in data &&
    typeof (data as MessageUpdatedContents).message_id === "string" &&
    typeof (data as MessageUpdatedContents).role === "string"
  )
}

/** Type guard for MessageDeletedContents */
export function isMessageDeletedContents(
  data: unknown
): data is MessageDeletedContents {
  return (
    typeof data === "object" &&
    data !== null &&
    "message_id" in data &&
    typeof (data as MessageDeletedContents).message_id === "string"
  )
}

/** Type guard for ToolStartedContents */
export function isToolStartedContents(
  data: unknown
): data is ToolStartedContents {
  return (
    typeof data === "object" &&
    data !== null &&
    "tool_name" in data &&
    "call_id" in data &&
    typeof (data as ToolStartedContents).tool_name === "string" &&
    typeof (data as ToolStartedContents).call_id === "string"
  )
}

/** Type guard for ToolCompletedContents */
export function isToolCompletedContents(
  data: unknown
): data is ToolCompletedContents {
  return (
    typeof data === "object" &&
    data !== null &&
    "tool_name" in data &&
    "call_id" in data &&
    typeof (data as ToolCompletedContents).tool_name === "string" &&
    typeof (data as ToolCompletedContents).call_id === "string"
  )
}

/** Type guard for ToolFailedContents */
export function isToolFailedContents(
  data: unknown
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
  )
}

/** Type guard for ToolExecuteBeforeContents */
export function isToolExecuteBeforeContents(
  data: unknown
): data is ToolExecuteBeforeContents {
  return (
    typeof data === "object" &&
    data !== null &&
    "tool_name" in data &&
    "call_id" in data &&
    typeof (data as ToolExecuteBeforeContents).tool_name === "string" &&
    typeof (data as ToolExecuteBeforeContents).call_id === "string"
  )
}

/** Type guard for ToolExecuteAfterContents */
export function isToolExecuteAfterContents(
  data: unknown
): data is ToolExecuteAfterContents {
  return (
    typeof data === "object" &&
    data !== null &&
    "tool_name" in data &&
    "call_id" in data &&
    "status" in data &&
    typeof (data as ToolExecuteAfterContents).tool_name === "string" &&
    typeof (data as ToolExecuteAfterContents).call_id === "string" &&
    typeof (data as ToolExecuteAfterContents).status === "string"
  )
}

/** Type guard for FileCreatedContents */
export function isFileCreatedContents(
  data: unknown
): data is FileCreatedContents {
  return (
    typeof data === "object" &&
    data !== null &&
    "file_path" in data &&
    typeof (data as FileCreatedContents).file_path === "string"
  )
}

/** Type guard for FileEditedContents */
export function isFileEditedContents(
  data: unknown
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
  )
}

/** Type guard for FileDeletedContents */
export function isFileDeletedContents(
  data: unknown
): data is FileDeletedContents {
  return (
    typeof data === "object" &&
    data !== null &&
    "file_path" in data &&
    typeof (data as FileDeletedContents).file_path === "string"
  )
}

/** Type guard for PermissionCreatedContents */
export function isPermissionCreatedContents(
  data: unknown
): data is PermissionCreatedContents {
  return (
    typeof data === "object" &&
    data !== null &&
    "permission_id" in data &&
    "permission_type" in data &&
    "pattern" in data &&
    typeof (data as PermissionCreatedContents).permission_id === "string" &&
    typeof (data as PermissionCreatedContents).permission_type === "string" &&
    typeof (data as PermissionCreatedContents).pattern === "string"
  )
}

/** Type guard for PermissionUpdatedContents */
export function isPermissionUpdatedContents(
  data: unknown
): data is PermissionUpdatedContents {
  return (
    typeof data === "object" &&
    data !== null &&
    "permission_id" in data &&
    "permission_type" in data &&
    "pattern" in data &&
    typeof (data as PermissionUpdatedContents).permission_id === "string" &&
    typeof (data as PermissionUpdatedContents).permission_type === "string" &&
    typeof (data as PermissionUpdatedContents).pattern === "string"
  )
}

/** Type guard for PermissionResolvedContents */
export function isPermissionResolvedContents(
  data: unknown
): data is PermissionResolvedContents {
  return (
    typeof data === "object" &&
    data !== null &&
    "permission_id" in data &&
    "permission_type" in data &&
    "pattern" in data &&
    "response" in data &&
    typeof (data as PermissionResolvedContents).permission_id === "string" &&
    typeof (data as PermissionResolvedContents).permission_type === "string" &&
    typeof (data as PermissionResolvedContents).pattern === "string" &&
    typeof (data as PermissionResolvedContents).response === "string"
  )
}

/** Type guard for UsageUpdatedContents */
export function isUsageUpdatedContents(
  data: unknown
): data is UsageUpdatedContents {
  return (
    typeof data === "object" &&
    data !== null &&
    "tokens" in data &&
    "cost_usd" in data &&
    typeof (data as UsageUpdatedContents).cost_usd === "number"
  )
}

/** Type guard for AgentStartedContents */
export function isAgentStartedContents(
  data: unknown
): data is AgentStartedContents {
  return (
    typeof data === "object" &&
    data !== null &&
    "agent_name" in data &&
    typeof (data as AgentStartedContents).agent_name === "string"
  )
}

/** Type guard for AgentCompletedContents */
export function isAgentCompletedContents(
  data: unknown
): data is AgentCompletedContents {
  return (
    typeof data === "object" &&
    data !== null &&
    "agent_name" in data &&
    typeof (data as AgentCompletedContents).agent_name === "string"
  )
}

/** Type guard for AgentFailedContents */
export function isAgentFailedContents(
  data: unknown
): data is AgentFailedContents {
  return (
    typeof data === "object" &&
    data !== null &&
    "agent_name" in data &&
    "error_message" in data &&
    typeof (data as AgentFailedContents).agent_name === "string" &&
    typeof (data as AgentFailedContents).error_message === "string"
  )
}

/** Type guard for ProviderConnectedContents */
export function isProviderConnectedContents(
  data: unknown
): data is ProviderConnectedContents {
  return (
    typeof data === "object" &&
    data !== null &&
    "provider_name" in data &&
    typeof (data as ProviderConnectedContents).provider_name === "string"
  )
}

/** Type guard for ProviderDisconnectedContents */
export function isProviderDisconnectedContents(
  data: unknown
): data is ProviderDisconnectedContents {
  return (
    typeof data === "object" &&
    data !== null &&
    "provider_name" in data &&
    typeof (data as ProviderDisconnectedContents).provider_name === "string"
  )
}

/** Type guard for ProviderErrorContents */
export function isProviderErrorContents(
  data: unknown
): data is ProviderErrorContents {
  return (
    typeof data === "object" &&
    data !== null &&
    "provider_name" in data &&
    "error_type" in data &&
    "error_message" in data &&
    typeof (data as ProviderErrorContents).provider_name === "string" &&
    typeof (data as ProviderErrorContents).error_type === "string" &&
    typeof (data as ProviderErrorContents).error_message === "string"
  )
}

/** Type guard for ConfigUpdatedContents */
export function isConfigUpdatedContents(
  data: unknown
): data is ConfigUpdatedContents {
  return (
    typeof data === "object" &&
    data !== null &&
    "config_path" in data &&
    typeof (data as ConfigUpdatedContents).config_path === "string"
  )
}

/** Type guard for ProjectCreatedContents */
export function isProjectCreatedContents(
  data: unknown
): data is ProjectCreatedContents {
  return (
    typeof data === "object" &&
    data !== null &&
    "project_path" in data &&
    typeof (data as ProjectCreatedContents).project_path === "string"
  )
}

/** Type guard for ProjectDeletedContents */
export function isProjectDeletedContents(
  data: unknown
): data is ProjectDeletedContents {
  return (
    typeof data === "object" &&
    data !== null &&
    "project_path" in data &&
    typeof (data as ProjectDeletedContents).project_path === "string"
  )
}

/** Type guard for SystemStartedContents */
export function isSystemStartedContents(
  data: unknown
): data is SystemStartedContents {
  return typeof data === "object" && data !== null
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
] as const
