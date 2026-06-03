/**
 * Canonical ingest event envelope shared between TS plugin and Rust sidecar.
 *
 * All fields are required unless marked optional. This ensures a stable
 * contract for fixture files that both runtimes parse.
 *
 * Privacy: metadata must never contain full tool inputs/outputs.
 * Only redacted summaries and call identifiers are allowed.
 */

export type EventType =
  | "session.created"
  | "session.deleted"
  | "tool.started"
  | "tool.completed"

export type ToolStatus = "started" | "completed" | "failed"

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
