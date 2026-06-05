/**
 * Snapshot type definitions for the Event-Sourced Stats Engine.
 *
 * Snapshots are periodic saves of projection data for fast recovery.
 * Four snapshot types: session, daily, weekly, monthly.
 */

import type {
  AgentUsage,
  ModelUsage,
} from "./projections.js"

// ============================================================================
// Snapshot Types
// ============================================================================

/** Snapshot type discriminator */
export type SnapshotType = "session" | "daily" | "weekly" | "monthly"

// ============================================================================
// Snapshot Data Types
// ============================================================================

/** Session snapshot data */
export interface SessionSnapshotData {
  session_id: string
  project_path: string
  title: string | null
  status: "active" | "deleted"
  deleted_at: number | null

  primary_model: string | null
  model_usage: ModelUsage | null

  duration_ms: number | null
  user_message_count: number
  assistant_message_count: number

  total_tokens: number
  input_tokens: number
  output_tokens: number
  reasoning_tokens: number
  cache_read: number
  cache_write: number
  total_cost_usd: number

  tool_call_count: number
  tool_error_count: number
  files_edited: number
  lines_added: number
  lines_deleted: number

  primary_agent: string | null
  agent_usage: AgentUsage | null

  error_count: number
}

/** Daily snapshot data */
export interface DailySnapshotData {
  date: string // YYYY-MM-DD
  period_start: number
  period_end: number

  sessions: {
    total: number
    active: number
    deleted: number
  }

  messages: {
    total: number
    user: number
    assistant: number
  }

  tokens: {
    total: number
    input: number
    output: number
    reasoning: number
    cache: {
      read: number
      write: number
    }
    by_model: Record<
      string,
      {
        total: number
        input: number
        output: number
        reasoning: number
        cache: {
          read: number
          write: number
        }
      }
    >
  }

  cost_usd: {
    total: number
    by_model: Record<string, number>
  }

  tools: {
    total_calls: number
    errors: number
    by_tool: Record<string, number>
  }

  files: {
    edited: number
    lines_added: number
    lines_deleted: number
  }

  agents: Record<
    string,
    {
      sessions: number
      tokens: number
    }
  >

  errors: {
    total: number
    by_type: Record<string, number>
  }
}

/** Weekly snapshot data (aggregated from daily) */
export interface WeeklySnapshotData {
  week: string // e.g., "2026-W23"
  period_start: number
  period_end: number

  // Aggregated from daily snapshots
  total_days: number
  sessions: DailySnapshotData["sessions"]
  messages: DailySnapshotData["messages"]
  tokens: DailySnapshotData["tokens"]
  cost_usd: DailySnapshotData["cost_usd"]
  tools: DailySnapshotData["tools"]
  files: DailySnapshotData["files"]
  agents: DailySnapshotData["agents"]
  errors: DailySnapshotData["errors"]
}

/** Monthly snapshot data (aggregated from daily) */
export interface MonthlySnapshotData {
  month: string // e.g., "2026-06"
  period_start: number
  period_end: number

  // Aggregated from daily snapshots
  total_days: number
  sessions: DailySnapshotData["sessions"]
  messages: DailySnapshotData["messages"]
  tokens: DailySnapshotData["tokens"]
  cost_usd: DailySnapshotData["cost_usd"]
  tools: DailySnapshotData["tools"]
  files: DailySnapshotData["files"]
  agents: DailySnapshotData["agents"]
  errors: DailySnapshotData["errors"]
}

// ============================================================================
// Snapshot Union
// ============================================================================

/** All snapshot data types */
export type SnapshotData =
  | SessionSnapshotData
  | DailySnapshotData
  | WeeklySnapshotData
  | MonthlySnapshotData

// ============================================================================
// Snapshot Record (database row)
// ============================================================================

/** Snapshot record stored in the database */
export interface SnapshotRecord {
  /** Format: {type}_{target}_{timestamp} */
  snapshot_id: string

  /** Snapshot type */
  snapshot_type: SnapshotType

  /** Target identifier (session_id or date range) */
  target_id: string

  /** Snapshot timestamp */
  snapshot_at: number

  /** Period start timestamp */
  period_start: number | null

  /** Period end timestamp */
  period_end: number | null

  /** JSON snapshot data */
  snapshot_data: SnapshotData

  /** Number of events in snapshot */
  event_count: number | null

  /** Creation timestamp */
  created_at: string
}

// ============================================================================
// Snapshot ID Helpers
// ============================================================================

/** Generate session snapshot ID */
export function generateSessionSnapshotId(
  sessionId: string,
  timestamp: number
): string {
  return `session_${sessionId}_${timestamp}`
}

/** Generate daily snapshot ID */
export function generateDailySnapshotId(
  date: string,
  timestamp: number
): string {
  return `daily_${date}_${timestamp}`
}

/** Generate weekly snapshot ID */
export function generateWeeklySnapshotId(
  week: string,
  timestamp: number
): string {
  return `weekly_${week}_${timestamp}`
}

/** Generate monthly snapshot ID */
export function generateMonthlySnapshotId(
  month: string,
  timestamp: number
): string {
  return `monthly_${month}_${timestamp}`
}

// ============================================================================
// Type Guards
// ============================================================================

/** Type guard for SessionSnapshotData */
export function isSessionSnapshotData(
  data: unknown
): data is SessionSnapshotData {
  return (
    typeof data === "object" &&
    data !== null &&
    "session_id" in data &&
    "project_path" in data &&
    "status" in data &&
    typeof (data as SessionSnapshotData).session_id === "string" &&
    typeof (data as SessionSnapshotData).project_path === "string"
  )
}

/** Type guard for DailySnapshotData */
export function isDailySnapshotData(
  data: unknown
): data is DailySnapshotData {
  return (
    typeof data === "object" &&
    data !== null &&
    "date" in data &&
    "period_start" in data &&
    "period_end" in data &&
    "sessions" in data &&
    typeof (data as DailySnapshotData).date === "string"
  )
}

/** Type guard for WeeklySnapshotData */
export function isWeeklySnapshotData(
  data: unknown
): data is WeeklySnapshotData {
  return (
    typeof data === "object" &&
    data !== null &&
    "week" in data &&
    "period_start" in data &&
    "period_end" in data &&
    "total_days" in data &&
    typeof (data as WeeklySnapshotData).week === "string"
  )
}

/** Type guard for MonthlySnapshotData */
export function isMonthlySnapshotData(
  data: unknown
): data is MonthlySnapshotData {
  return (
    typeof data === "object" &&
    data !== null &&
    "month" in data &&
    "period_start" in data &&
    "period_end" in data &&
    "total_days" in data &&
    typeof (data as MonthlySnapshotData).month === "string"
  )
}
