/**
 * SSE (Server-Sent Events) message type definitions.
 *
 * SSE is used for real-time invalidation notifications. Messages are
 * lightweight — they tell the dashboard *what changed*, not *how much*.
 * The dashboard re-fetches aggregated stats via REST after receiving a
 * notification.
 */

import type { StatsEventType } from "@defs/events";

// ============================================================================
// SSE Notification Contract
// ============================================================================

/**
 * Lightweight invalidation notification sent over SSE.
 *
 * Contains only enough metadata for the dashboard to decide which
 * queries to invalidate — no aggregate deltas (tokens, cost, etc.).
 */
export interface StatsNotification {
  /** Schema version — must be 1 */
  version: 1;

  /** Idempotency key (monotonic, unique per notification) */
  event_id: string;

  /** Event type — mirrors the StatsEvent that triggered this notification */
  event_type: StatsEventType;

  /** Wall-clock time the event occurred (milliseconds since epoch) */
  occurred_at_ms: number;

  /** Wall-clock time the event occurred (ISO 8601) */
  occurred_at: string;

  /** Session associated with the event (present when the event has one) */
  session_id?: string;
}

// ============================================================================
// SSE Connection State Types
// ============================================================================

/** SSE connection lifecycle state */
export type SSEConnectionState =
  | "connecting"
  | "connected"
  | "disconnected"
  | "reconnecting";

/** SSE client connection info (used by dashboard composable) */
export interface SSEClientInfo {
  /** Current connection state */
  state: SSEConnectionState;

  /** Last received event ID (for Last-Event-ID reconnection) */
  last_event_id: string | null;

  /** Unix timestamp when the connection was established */
  connected_at: number | null;

  /** Number of reconnection attempts since last successful connection */
  reconnect_attempts: number;
}

// ============================================================================
// SSE Frame Types
// ============================================================================

/** Low-level SSE frame structure (used by broadcaster encoding) */
export interface SSEFrame {
  /** Event type name (matches SSE_EVENT_NAME) */
  event: string;

  /** Event ID (for Last-Event-ID) */
  id: string;

  /** JSON-serialized data payload */
  data: string;
}

// ============================================================================
// Runtime Type Guards
// ============================================================================

/**
 * Type guard for {@link StatsNotification}.
 *
 * Returns `true` for valid notification JSON objects, `false` for:
 * - `null`, `undefined`, primitives (strings, numbers, booleans)
 * - Transport keepalive/comment frames (not JSON objects)
 * - Empty objects `{}`
 * - Objects missing required fields or with wrong types
 * - Heartbeat-like payloads
 */
export function isStatsNotification(data: unknown): data is StatsNotification {
  if (typeof data !== "object" || data === null) {
    return false;
  }

  const obj = data as Record<string, unknown>;

  if (obj.version !== 1) {
    return false;
  }

  if (typeof obj.event_id !== "string" || obj.event_id.length === 0) {
    return false;
  }

  if (typeof obj.event_type !== "string" || obj.event_type.length === 0) {
    return false;
  }

  if (
    typeof obj.occurred_at_ms !== "number" ||
    !Number.isFinite(obj.occurred_at_ms)
  ) {
    return false;
  }

  if (typeof obj.occurred_at !== "string" || obj.occurred_at.length === 0) {
    return false;
  }

  // session_id is optional, but if present must be a string
  if ("session_id" in obj && typeof obj.session_id !== "string") {
    return false;
  }

  return true;
}

// ============================================================================
// SSE Constants
// ============================================================================

/** Named SSE event type — dashboard listens via `addEventListener(SSE_EVENT_NAME, …)` */
export const SSE_EVENT_NAME = "notification" as const;

/**
 * SSE keepalive comment frame.
 *
 * Format: `: keepalive\n\n` — colon-prefixed lines are comment frames
 * per the SSE spec and are silently ignored by EventSource clients.
 * Must NOT contain a `data:` field.
 */
export const SSE_KEEPALIVE = ": keepalive\n\n" as const;
