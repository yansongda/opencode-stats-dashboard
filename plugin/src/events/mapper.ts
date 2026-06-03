/**
 * Maps raw OpenCode events into the canonical IngestEventEnvelope format.
 *
 * Responsibilities:
 *   1. Generate a stable, deterministic event_id from session_id + timestamp + event_type
 *   2. Strip forbidden metadata keys (tool_input, tool_output, etc.)
 *   3. Provide sensible defaults for optional fields
 *
 * Privacy: this is the boundary where raw payloads are REDACTED.
 * No full tool inputs/outputs ever leave the mapper.
 */

import type {
  IngestEventEnvelope,
  EventType,
  ToolStatus,
} from "../types"
import { FORBIDDEN_METADATA_KEYS } from "../types"

/**
 * Shape of a raw OpenCode event as received from plugin hooks.
 *
 * Only `event_type`, `session_id`, `project_path`, and `timestamp_ms`
 * are truly required — everything else has sensible defaults.
 */
export interface RawOpenCodeEvent {
  event_type: EventType
  session_id: string
  project_path: string
  timestamp_ms: number
  model?: string
  tokens?: number
  cost_usd?: number
  tool?: string
  status?: ToolStatus | null
  summary?: string | null
  deleted?: boolean
  metadata?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate a stable 128-bit hash formatted as a UUID-like string.
 *
 * Uses FNV-1a across 4 independent rounds so the same inputs always
 * produce the same output — critical for idempotent deduplication.
 */
export function generateEventId(
  session_id: string,
  timestamp_ms: number,
  event_type: string,
): string {
  const input = `${session_id}:${timestamp_ms}:${event_type}`
  const parts: number[] = []
  let seed = 0x811c9dc5 // FNV offset basis

  for (let round = 0; round < 4; round++) {
    let hash = seed
    for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i)
      hash = Math.imul(hash, 0x01000193) // FNV prime
    }
    parts.push(hash >>> 0) // unsigned
    seed = hash ^ (round * 0x1b873593)
  }

  const hex = parts.map((p) => p.toString(16).padStart(8, "0")).join("")
  return [
    "evt",
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-")
}

/**
 * Remove forbidden keys from a metadata record.
 *
 * Keys listed in FORBIDDEN_METADATA_KEYS (tool_input, tool_output,
 * message_body, raw_input, raw_output) are stripped so that full
 * payloads never reach the sidecar.
 */
export function sanitizeMetadata(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (
      !(FORBIDDEN_METADATA_KEYS as readonly string[]).includes(key)
    ) {
      sanitized[key] = value
    }
  }
  return sanitized
}

// ---------------------------------------------------------------------------
// Main mapper
// ---------------------------------------------------------------------------

/**
 * Convert a raw OpenCode event into a fully-formed IngestEventEnvelope.
 *
 * - Generates a deterministic `event_id` for idempotent deduplication
 * - Strips privacy-sensitive metadata keys
 * - Fills defaults for optional fields
 */
export function mapOpenCodeEvent(
  raw: RawOpenCodeEvent,
): IngestEventEnvelope {
  const event_id = generateEventId(
    raw.session_id,
    raw.timestamp_ms,
    raw.event_type,
  )

  const isSessionEvent =
    raw.event_type === "session.created" ||
    raw.event_type === "session.deleted"

  return {
    event_id,
    event_type: raw.event_type,
    session_id: raw.session_id,
    project_path: raw.project_path,
    timestamp_ms: raw.timestamp_ms,
    model: raw.model ?? "unknown",
    tokens: raw.tokens ?? 0,
    cost_usd: raw.cost_usd ?? 0,
    tool: isSessionEvent ? (raw.tool ?? null) : (raw.tool ?? null),
    status: isSessionEvent ? (raw.status ?? null) : (raw.status ?? null),
    summary: raw.summary ?? null,
    deleted: raw.deleted ?? raw.event_type === "session.deleted",
    metadata: sanitizeMetadata(raw.metadata ?? {}),
  }
}
