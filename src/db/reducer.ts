/**
 * Session and tool-call state reducers for processing ingest events.
 *
 * - {@link processSessionEvent} maintains the `sessions` aggregated table by
 *   reacting to session lifecycle events. It never deletes session rows —
 *   deletion events only set `deleted = true` to preserve audit history.
 * - {@link processToolEvent} maintains the `tool_calls` table by reacting to
 *   tool lifecycle events (`tool.started`, `tool.completed`, `tool.failed`).
 */

import { Database } from "bun:sqlite"
import type { IngestEventEnvelope } from "../types"

/**
 * Process a single ingest event and update the sessions table.
 *
 * - `session.created` → INSERT OR REPLACE into sessions
 * - `session.deleted` → UPDATE sessions SET deleted=true, preserve usage
 * - `usage.updated`   → UPDATE sessions SET total_tokens += N, total_cost_usd += N
 *
 * Unknown event types are silently ignored.
 */
export function processSessionEvent(
  db: Database,
  event: IngestEventEnvelope
): void {
  switch (event.event_type) {
    case "session.created": {
      db.run(
        `INSERT OR REPLACE INTO sessions (
            session_id, project_path, model,
            total_tokens, total_cost_usd,
            deleted, deleted_at,
            first_event_at, last_event_at,
            tool_call_count
        ) VALUES (
            ?, ?, ?,
            ?, ?,
            FALSE, NULL,
            datetime(? / 1000, 'unixepoch'),
            datetime(? / 1000, 'unixepoch'),
            0
        )`,
        [
          event.session_id,
          event.project_path,
          event.model,
          event.tokens,
          event.cost_usd,
          event.timestamp_ms,
          event.timestamp_ms,
        ]
      )
      break
    }
    case "session.deleted": {
      db.run(
        `UPDATE sessions
        SET deleted       = TRUE,
            deleted_at    = datetime(? / 1000, 'unixepoch'),
            last_event_at = datetime(? / 1000, 'unixepoch'),
            total_tokens  = ?,
            total_cost_usd = ?
        WHERE session_id = ?`,
        [
          event.timestamp_ms,
          event.timestamp_ms,
          event.tokens,
          event.cost_usd,
          event.session_id,
        ]
      )
      break
    }
    case "usage.updated": {
      db.run(
        `UPDATE sessions
        SET total_tokens   = total_tokens + ?,
            total_cost_usd = total_cost_usd + ?,
            last_event_at  = datetime(? / 1000, 'unixepoch')
        WHERE session_id = ?`,
        [event.tokens, event.cost_usd, event.timestamp_ms, event.session_id]
      )
      break
    }
    // Unknown event types — nothing to reduce for sessions.
  }
}

/**
 * Process a tool lifecycle event and update the `tool_calls` table.
 *
 * - `tool.started`   → INSERT OR IGNORE into tool_calls
 * - `tool.completed` → UPDATE tool_calls SET status='completed', ...
 * - `tool.failed`    → UPDATE tool_calls SET status='failed'
 *
 * Uses `(session_id, tool_name, started_at)` for stable identity via the
 * UNIQUE constraint. The "completed" and "failed" updates target the most
 * recent "started" row matching the session+tool pair.
 *
 * @throws {Error} if the event is missing required `tool` or `status` fields.
 * @throws {Error} if "completed"/"failed" has no matching "started" record.
 */
export function processToolEvent(
  db: Database,
  event: IngestEventEnvelope
): void {
  const toolName = event.tool
  const status = event.status

  if (!toolName) {
    throw new Error("event missing required 'tool' field")
  }
  if (!status) {
    throw new Error("event missing required 'status' field")
  }

  switch (status) {
    case "started": {
      db.run(
        `INSERT OR IGNORE INTO tool_calls (
            tool_name, session_id, status, model, tokens, cost_usd,
            started_at, completed_at, summary
        ) VALUES (?, ?, ?, ?, ?, ?, datetime(? / 1000, 'unixepoch'), NULL, ?)`,
        [
          toolName,
          event.session_id,
          "started",
          event.model,
          event.tokens,
          event.cost_usd,
          event.timestamp_ms,
          event.summary,
        ]
      )
      break
    }
    case "completed": {
      const result = db.run(
        `UPDATE tool_calls
        SET status = 'completed',
            completed_at = datetime(? / 1000, 'unixepoch'),
            tokens = ?,
            cost_usd = ?,
            summary = ?
        WHERE id = (
            SELECT id FROM tool_calls
            WHERE session_id = ? AND tool_name = ? AND status = 'started'
            ORDER BY started_at DESC
            LIMIT 1
        )`,
        [
          event.timestamp_ms,
          event.tokens,
          event.cost_usd,
          event.summary,
          event.session_id,
          toolName,
        ]
      )
      if (result.changes === 0) {
        throw new Error("no matching 'started' record found for tool call")
      }
      break
    }
    case "failed": {
      const result = db.run(
        `UPDATE tool_calls
        SET status = 'failed'
        WHERE id = (
            SELECT id FROM tool_calls
            WHERE session_id = ? AND tool_name = ? AND status = 'started'
            ORDER BY started_at DESC
            LIMIT 1
        )`,
        [event.session_id, toolName]
      )
      if (result.changes === 0) {
        throw new Error("no matching 'started' record found for tool call")
      }
      break
    }
    // Unknown tool status — silently ignored.
  }
}
