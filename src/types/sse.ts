/**
 * SSE (Server-Sent Events) message type definitions.
 *
 * SSE is used for real-time notifications. Messages are lightweight
 * and only contain event metadata, not full data payloads.
 */

// ============================================================================
// SSE Event Types
// ============================================================================

/** SSE event category */
export type SSEEventType = "session" | "tool" | "message" | "error" | "file"

/** SSE action type */
export type SSEAction = "created" | "updated" | "deleted"

// ============================================================================
// SSE Message Types
// ============================================================================

/** SSE delta data (incremental updates) */
export interface SSEDelta {
  tokens?: number
  cost_usd?: number
  tool_calls?: number
  errors?: number
}

/** SSE update message */
export interface StatsUpdate {
  /** Event ID */
  event_id: string

  /** ISO timestamp */
  timestamp: string

  /** Event category */
  type: SSEEventType

  /** Action type */
  action: SSEAction

  /** Associated session ID */
  session_id?: string

  /** Incremental data */
  delta?: SSEDelta
}

// ============================================================================
// SSE Frame Types
// ============================================================================

/** SSE frame structure */
export interface SSEFrame {
  /** Event type (always "stats-update") */
  event: string

  /** Event ID */
  id: string

  /** JSON data */
  data: string
}

// ============================================================================
// SSE Connection Types
// ============================================================================

/** SSE connection state */
export type SSEConnectionState =
  | "connecting"
  | "connected"
  | "disconnected"
  | "reconnecting"

/** SSE client info */
export interface SSEClientInfo {
  /** Connection state */
  state: SSEConnectionState

  /** Last received event ID */
  last_event_id: string | null

  /** Connection timestamp */
  connected_at: number | null

  /** Reconnection attempt count */
  reconnect_attempts: number
}

// ============================================================================
// Type Guards
// ============================================================================

/** Type guard for StatsUpdate */
export function isStatsUpdate(data: unknown): data is StatsUpdate {
  return (
    typeof data === "object" &&
    data !== null &&
    "event_id" in data &&
    "timestamp" in data &&
    "type" in data &&
    "action" in data &&
    typeof (data as StatsUpdate).event_id === "string" &&
    typeof (data as StatsUpdate).timestamp === "string" &&
    typeof (data as StatsUpdate).type === "string" &&
    typeof (data as StatsUpdate).action === "string"
  )
}

/** Type guard for SSEDelta */
export function isSSEDelta(data: unknown): data is SSEDelta {
  return typeof data === "object" && data !== null
}

// ============================================================================
// SSE Event Name Constants
// ============================================================================

/** SSE event name for stats updates */
export const SSE_EVENT_NAME = "stats-update" as const

/** SSE keepalive comment */
export const SSE_KEEPALIVE = ": keepalive" as const
