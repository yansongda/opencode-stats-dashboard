/**
 * Snapshot Manager — generates, retrieves, and validates projection snapshots.
 *
 * Responsibilities:
 *  - Generate session snapshots from projection_sessions (§5.4)
 *  - Generate daily snapshots by aggregating projection_daily (§5.4)
 *  - Retrieve snapshots by type + target (latest first)
 *  - Validate snapshot freshness against events table (§5.6)
 *  - Query-time completion: auto-generate missing snapshots (§5.5)
 *
 * Only implements session + daily snapshots (weekly/monthly deferred to Phase 3).
 */

import type { Database } from "bun:sqlite"
import type {
  SessionSnapshotData,
  DailySnapshotData,
  SnapshotRecord,
  SnapshotType,
} from "../types/snapshots"
import {
  generateSessionSnapshotId,
  generateDailySnapshotId,
  isSessionSnapshotData,
  isDailySnapshotData,
} from "../types/snapshots"
import type {
  ModelUsage,
  AgentUsage,
  ProjectionSession,
  ProjectionDaily,
} from "../types/projections"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Start of day in ms (UTC) for a YYYY-MM-DD string. */
function dayStartMs(date: string): number {
  return new Date(`${date}T00:00:00.000Z`).getTime()
}

/** End of day in ms (UTC) for a YYYY-MM-DD string. */
function dayEndMs(date: string): number {
  return new Date(`${date}T23:59:59.999Z`).getTime()
}

// ---------------------------------------------------------------------------
// SnapshotManager
// ---------------------------------------------------------------------------

export class SnapshotManager {
  private readonly db: Database

  constructor(db: Database) {
    this.db = db
  }

  // =========================================================================
  // Session Snapshot
  // =========================================================================

  /**
   * Generate a session snapshot from projection_sessions.
   *
   * @returns The persisted SnapshotRecord, or null if the session doesn't exist.
   */
  generateSessionSnapshot(sessionId: string): SnapshotRecord | null {
    const row = this.db
      .query("SELECT * FROM projection_sessions WHERE session_id = ?")
      .get(sessionId) as ProjectionSession | null

    if (!row) return null

    const now = Date.now()
    const snapshotId = generateSessionSnapshotId(sessionId, now)

    const data: SessionSnapshotData = {
      session_id: row.session_id,
      project_path: row.project_path ?? "",
      title: row.title,
      status: row.status,
      deleted_at: row.deleted_at,

      primary_model: row.primary_model,
      model_usage: this.parseModelUsage(row.model_usage),

      duration_ms: row.duration_ms,
      user_message_count: row.user_message_count,
      assistant_message_count: row.assistant_message_count,

      total_tokens: row.total_tokens,
      input_tokens: row.input_tokens,
      output_tokens: row.output_tokens,
      reasoning_tokens: row.reasoning_tokens,
      cache_read: row.cache_read,
      cache_write: row.cache_write,
      total_cost_usd: row.total_cost_usd,

      tool_call_count: row.tool_call_count,
      tool_error_count: row.tool_error_count,
      files_edited: row.files_edited,
      lines_added: row.lines_added,
      lines_deleted: row.lines_deleted,

      primary_agent: row.primary_agent,
      agent_usage: this.parseAgentUsage(row.agent_usage),

      error_count: row.error_count,
    }

    const snapshotData = JSON.stringify(data)
    const eventCount = row.event_count ?? 0

    this.db
      .query(
        `INSERT INTO snapshots
           (snapshot_id, snapshot_type, target_id, snapshot_at, period_start, period_end, snapshot_data, event_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        snapshotId,
        "session",
        sessionId,
        now,
        row.first_event_at,
        row.last_event_at,
        snapshotData,
        eventCount
      )

    return {
      snapshot_id: snapshotId,
      snapshot_type: "session",
      target_id: sessionId,
      snapshot_at: now,
      period_start: row.first_event_at,
      period_end: row.last_event_at,
      snapshot_data: data,
      event_count: eventCount,
      created_at: new Date(now).toISOString(),
    }
  }

  // =========================================================================
  // Daily Snapshot
  // =========================================================================

  /**
   * Generate a daily snapshot by aggregating all projection_daily rows for a date.
   *
   * @returns The persisted SnapshotRecord, or null if no projection rows exist.
   */
  generateDailySnapshot(date: string): SnapshotRecord | null {
    const rows = this.db
      .query("SELECT * FROM projection_daily WHERE date = ?")
      .all(date) as ProjectionDaily[]

    if (rows.length === 0) return null

    const now = Date.now()
    const snapshotId = generateDailySnapshotId(date, now)
    const periodStart = dayStartMs(date)
    const periodEnd = dayEndMs(date)

    const data = this.aggregateDailyRows(date, rows, periodStart, periodEnd)

    // Validate with type guard
    if (!isDailySnapshotData(data)) {
      return null
    }

    const snapshotData = JSON.stringify(data)
    const eventCount = rows.reduce((sum, r) => sum + (r.event_count ?? 0), 0)

    this.db
      .query(
        `INSERT INTO snapshots
           (snapshot_id, snapshot_type, target_id, snapshot_at, period_start, period_end, snapshot_data, event_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        snapshotId,
        "daily",
        date,
        now,
        periodStart,
        periodEnd,
        snapshotData,
        eventCount
      )

    return {
      snapshot_id: snapshotId,
      snapshot_type: "daily",
      target_id: date,
      snapshot_at: now,
      period_start: periodStart,
      period_end: periodEnd,
      snapshot_data: data,
      event_count: eventCount,
      created_at: new Date(now).toISOString(),
    }
  }

  // =========================================================================
  // Snapshot Retrieval
  // =========================================================================

  /**
   * Retrieve the latest snapshot for a given type and target.
   *
   * @returns The latest SnapshotRecord or null if none exists.
   */
  getSnapshot(type: SnapshotType, targetId: string): SnapshotRecord | null {
    const row = this.db
      .query(
        `SELECT * FROM snapshots
         WHERE snapshot_type = ? AND target_id = ?
         ORDER BY snapshot_at DESC
         LIMIT 1`
      )
      .get(type, targetId) as Record<string, unknown> | null

    if (!row) return null

    return this.rowToSnapshotRecord(row)
  }

  // =========================================================================
  // Snapshot Validity
  // =========================================================================

  /**
   * Check if a snapshot is still valid (no new events since snapshot).
   *
   * For session snapshots: checks events for that session after snapshot_at.
   * For daily snapshots: checks events within that day after snapshot_at.
   *
   * @returns true if valid, false if stale or missing.
   */
  isSnapshotValid(type: SnapshotType, targetId: string): boolean {
    const snapshot = this.getSnapshot(type, targetId)
    if (!snapshot) return false

    let newEventCount: number

    if (type === "session") {
      const row = this.db
        .query(
          `SELECT COUNT(*) as cnt FROM events
           WHERE session_id = ? AND timestamp_ms > ?`
        )
        .get(targetId, snapshot.snapshot_at) as { cnt: number }
      newEventCount = row.cnt
    } else {
      // Daily: check events within the day's range after snapshot time
      const startMs = dayStartMs(targetId)
      const endMs = dayEndMs(targetId)
      const row = this.db
        .query(
          `SELECT COUNT(*) as cnt FROM events
           WHERE timestamp_ms >= ? AND timestamp_ms <= ? AND timestamp_ms > ?`
        )
        .get(startMs, endMs, snapshot.snapshot_at) as { cnt: number }
      newEventCount = row.cnt
    }

    return newEventCount === 0
  }

  // =========================================================================
  // Query-time Completion
  // =========================================================================

  /**
   * Get an existing daily snapshot or generate one if missing/invalid.
   *
   * Implements §5.5 query-time completion:
   *  1. Try to get existing snapshot
   *  2. If valid, return it
   *  3. If missing or invalid, generate a new one
   *
   * @returns The snapshot or null if no projection data exists for the date.
   */
  getOrGenerateDailySnapshot(date: string): SnapshotRecord | null {
    const existing = this.getSnapshot("daily", date)

    if (existing && this.isSnapshotValid("daily", date)) {
      return existing
    }

    // If there's an existing but invalid snapshot, delete it before regenerating
    // to avoid UNIQUE constraint on snapshot_id (same ms timestamp).
    if (existing) {
      this.db
        .query("DELETE FROM snapshots WHERE snapshot_id = ?")
        .run(existing.snapshot_id)
    }

    return this.generateDailySnapshot(date)
  }

  // =========================================================================
  // Internal — Daily Aggregation
  // =========================================================================

  /**
   * Aggregate multiple projection_daily rows into a single DailySnapshotData.
   */
  private aggregateDailyRows(
    date: string,
    rows: ProjectionDaily[],
    periodStart: number,
    periodEnd: number
  ): DailySnapshotData {
    // Session aggregation
    let totalSessions = 0
    let activeSessions = 0
    let deletedSessions = 0

    // Message aggregation
    let totalMessages = 0
    let userMessages = 0
    let assistantMessages = 0

    // Token aggregation (top-level)
    let totalTokens = 0
    let inputTokens = 0
    let outputTokens = 0
    let reasoningTokens = 0
    let cacheRead = 0
    let cacheWrite = 0

    // Token by model
    const tokensByModel: Record<
      string,
      {
        total: number
        input: number
        output: number
        reasoning: number
        cache: { read: number; write: number }
      }
    > = {}

    // Cost aggregation
    let totalCost = 0
    const costByModel: Record<string, number> = {}

    // Tool aggregation
    let totalToolCalls = 0
    let toolErrors = 0

    // File aggregation
    let filesEdited = 0
    let linesAdded = 0
    let linesDeleted = 0

    // Agent aggregation
    const agents: Record<string, { sessions: number; tokens: number }> = {}

    // Error aggregation
    let totalErrors = 0

    for (const row of rows) {
      // Sessions
      totalSessions += row.session_count
      activeSessions += row.active_sessions
      deletedSessions += row.deleted_sessions

      // Messages
      totalMessages += row.message_count
      userMessages += row.user_messages
      assistantMessages += row.assistant_messages

      // Tokens (top-level)
      totalTokens += row.total_tokens
      inputTokens += row.input_tokens
      outputTokens += row.output_tokens
      reasoningTokens += row.reasoning_tokens
      cacheRead += row.cache_read
      cacheWrite += row.cache_write

      // Tokens by model
      if (!tokensByModel[row.model]) {
        tokensByModel[row.model] = {
          total: 0,
          input: 0,
          output: 0,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        }
      }
      const modelEntry = tokensByModel[row.model]!
      modelEntry.total += row.total_tokens
      modelEntry.input += row.input_tokens
      modelEntry.output += row.output_tokens
      modelEntry.reasoning += row.reasoning_tokens
      modelEntry.cache.read += row.cache_read
      modelEntry.cache.write += row.cache_write

      // Cost
      totalCost += row.total_cost_usd
      costByModel[row.model] =
        (costByModel[row.model] ?? 0) + row.total_cost_usd

      // Tools
      totalToolCalls += row.tool_calls
      toolErrors += row.tool_errors

      // Files
      filesEdited += row.files_edited
      linesAdded += row.lines_added
      linesDeleted += row.lines_deleted

      // Agents
      if (row.agent_usage) {
        const parsed = this.parseAgentUsage(row.agent_usage)
        if (parsed) {
          for (const [agentName, agentData] of Object.entries(parsed)) {
            if (!agents[agentName]) {
              agents[agentName] = { sessions: 0, tokens: 0 }
            }
            agents[agentName]!.sessions += 1
            agents[agentName]!.tokens += agentData.tokens.input + agentData.tokens.output + agentData.tokens.reasoning
          }
        }
      }

      // Errors
      totalErrors += row.error_count
    }

    return {
      date,
      period_start: periodStart,
      period_end: periodEnd,

      sessions: {
        total: totalSessions,
        active: activeSessions,
        deleted: deletedSessions,
      },

      messages: {
        total: totalMessages,
        user: userMessages,
        assistant: assistantMessages,
      },

      tokens: {
        total: totalTokens,
        input: inputTokens,
        output: outputTokens,
        reasoning: reasoningTokens,
        cache: {
          read: cacheRead,
          write: cacheWrite,
        },
        by_model: tokensByModel,
      },

      cost_usd: {
        total: totalCost,
        by_model: costByModel,
      },

      tools: {
        total_calls: totalToolCalls,
        errors: toolErrors,
        by_tool: {},
      },

      files: {
        edited: filesEdited,
        lines_added: linesAdded,
        lines_deleted: linesDeleted,
      },

      agents,

      errors: {
        total: totalErrors,
        by_type: {},
      },
    }
  }

  // =========================================================================
  // Internal — JSON Field Parsing with Type Guards
  // =========================================================================

  /**
   * Parse model_usage JSON with type guard validation.
   * Returns null if data is null or invalid.
   */
  private parseModelUsage(value: string | ModelUsage | null): ModelUsage | null {
    if (!value) return null
    if (typeof value !== "string") return value
    try {
      const parsed: unknown = JSON.parse(value)
      if (typeof parsed === "object" && parsed !== null) {
        return parsed as ModelUsage
      }
      return null
    } catch {
      return null
    }
  }

  /**
   * Parse agent_usage JSON with type guard validation.
   * Returns null if data is null or invalid.
   */
  private parseAgentUsage(value: string | AgentUsage | null): AgentUsage | null {
    if (!value) return null
    if (typeof value !== "string") return value
    try {
      const parsed: unknown = JSON.parse(value)
      if (typeof parsed === "object" && parsed !== null) {
        return parsed as AgentUsage
      }
      return null
    } catch {
      return null
    }
  }

  // =========================================================================
  // Internal — Row Mapping
  // =========================================================================

  /**
   * Convert a raw database row to a typed SnapshotRecord.
   */
  private rowToSnapshotRecord(
    row: Record<string, unknown>
  ): SnapshotRecord {
    const rawData = row['snapshot_data'] as string
    let snapshotData: SessionSnapshotData | DailySnapshotData

    try {
      const parsed: unknown = JSON.parse(rawData)
      if (isSessionSnapshotData(parsed)) {
        snapshotData = parsed
      } else if (isDailySnapshotData(parsed)) {
        snapshotData = parsed
      } else {
        // Fallback — store raw parsed data
        snapshotData = parsed as SessionSnapshotData | DailySnapshotData
      }
    } catch {
      snapshotData = {} as SessionSnapshotData
    }

    return {
      snapshot_id: row['snapshot_id'] as string,
      snapshot_type: row['snapshot_type'] as SnapshotType,
      target_id: row['target_id'] as string,
      snapshot_at: row['snapshot_at'] as number,
      period_start: (row['period_start'] as number) ?? null,
      period_end: (row['period_end'] as number) ?? null,
      snapshot_data: snapshotData,
      event_count: (row['event_count'] as number) ?? null,
      created_at: row['created_at'] as string,
    }
  }
}
