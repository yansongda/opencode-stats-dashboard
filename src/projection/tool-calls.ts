/**
 * projection_tool_calls handler — tracks individual tool call lifecycle.
 *
 * Processes:
 *  - tool.completed  → INSERT (or UPDATE) row with status='completed'
 *  - tool.failed     → INSERT (or UPDATE) row with status='error'
 *
 * Both handlers self-INSERT when no prior row exists, because the upstream
 * SDK does not emit a tool.started event — tool.failed is derived from
 * message.part.updated where state.status === "error" (no preamble).
 *
 * Design doc: §4.3 projection_tool_calls
 */

import type {
  StatsEvent,
  StatsEventType,
  ToolCompletedEvent,
  ToolFailedEvent,
} from "@defs/events";
import type { ProjectionHandler, TransactionContext } from "@defs/projections";

// ---------------------------------------------------------------------------
// Event Handlers
// ---------------------------------------------------------------------------

function handleToolCompleted(
  event: ToolCompletedEvent,
  txn: TransactionContext,
): void {
  const callId = event.call_id;
  const toolName = event.tool_name;
  const title = event.title;
  const durationMs = event.duration_ms;

  // Extract token breakdown
  const tokens = event.tokens;
  const input = tokens?.input ?? 0;
  const output = tokens?.output ?? 0;
  const cache_read = tokens?.cache?.read ?? 0;
  const cache_write = tokens?.cache?.write ?? 0;

  // Check if the tool call record exists
  const existing = txn.get(
    "SELECT call_id FROM projection_tool_calls WHERE call_id = ?",
    [callId],
  );

  if (!existing) {
    // Insert new record if it doesn't exist (no prior tool.started event)
    txn.run(
      `INSERT OR IGNORE INTO projection_tool_calls
         (call_id, session_id, tool_name, status, started_at, completed_at, duration_ms,
          input_tokens, output_tokens, cache_read, cache_write, cost_usd, title)
       VALUES (?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        callId,
        event.session_id,
        toolName,
        event.timestamp_ms,
        event.timestamp_ms,
        durationMs || null,
        input,
        output,
        cache_read,
        cache_write,
        event.cost_usd,
        title,
      ],
    );
    return;
  }

  txn.run(
    `UPDATE projection_tool_calls
     SET status = 'completed',
         completed_at = ?,
         duration_ms = ?,
         input_tokens = ?,
         output_tokens = ?,
         cache_read = ?,
         cache_write = ?,
         cost_usd = ?,
         title = COALESCE(?, title),
         projected_at = CURRENT_TIMESTAMP
     WHERE call_id = ?`,
    [
      event.timestamp_ms,
      durationMs || null,
      input,
      output,
      cache_read,
      cache_write,
      event.cost_usd,
      title,
      callId,
    ],
  );
}

function handleToolFailed(
  event: ToolFailedEvent,
  txn: TransactionContext,
): void {
  const callId = event.call_id;
  const errorMessage = event.error_message;
  const durationMs = event.duration_ms;

  const existing = txn.get(
    "SELECT call_id FROM projection_tool_calls WHERE call_id = ?",
    [callId],
  );

  if (!existing) {
    txn.run(
      `INSERT OR IGNORE INTO projection_tool_calls
         (call_id, session_id, tool_name, status, started_at, completed_at, duration_ms, error_message)
       VALUES (?, ?, ?, 'error', ?, ?, ?, ?)`,
      [
        callId,
        event.session_id,
        event.tool_name,
        event.timestamp_ms,
        event.timestamp_ms,
        durationMs || null,
        errorMessage,
      ],
    );
    return;
  }

  txn.run(
    `UPDATE projection_tool_calls
     SET status = 'error',
         completed_at = ?,
         duration_ms = ?,
         error_message = ?,
         projected_at = CURRENT_TIMESTAMP
     WHERE call_id = ?`,
    [event.timestamp_ms, durationMs || null, errorMessage, callId],
  );
}

// ---------------------------------------------------------------------------
// Handler Export
// ---------------------------------------------------------------------------

const HANDLED_EVENTS: StatsEventType[] = ["tool.completed", "tool.failed"];

/**
 * ProjectionHandler for projection_tool_calls table.
 *
 * Handles tool lifecycle events:
 *  - tool.completed  → update record (completed + stats)
 *  - tool.failed     → update record (error + message)
 */
export const toolCallHandler: ProjectionHandler = {
  handles: HANDLED_EVENTS,

  handle(event: StatsEvent, txn: TransactionContext): void {
    switch (event.event_type) {
      case "tool.completed":
        handleToolCompleted(event, txn);
        break;
      case "tool.failed":
        handleToolFailed(event, txn);
        break;
    }
  },
};
