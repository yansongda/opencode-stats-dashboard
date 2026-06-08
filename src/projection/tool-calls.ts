/**
 * projection_tool_calls handler — tracks individual tool call lifecycle.
 *
 * Processes:
 *  - tool.execute.before → INSERT row with started_at timestamp
 *  - tool.execute.after  → UPDATE row with status='completed'
 *  - tool.failed         → UPDATE row with status='error'
 *
 * Design doc: §4.3 projection_tool_calls
 */

import type {
  StatsEvent,
  StatsEventType,
  ToolExecuteAfterEvent,
  ToolExecuteBeforeEvent,
  ToolFailedEvent,
} from "@defs/events";
import type { ProjectionHandler, TransactionContext } from "@defs/projections";

// ---------------------------------------------------------------------------
// Event Handlers
// ---------------------------------------------------------------------------

function handleToolExecuteBefore(
  event: ToolExecuteBeforeEvent,
  txn: TransactionContext,
): void {
  txn.run(
    `INSERT OR IGNORE INTO projection_tool_calls
       (call_id, session_id, tool_name, status, started_at)
     VALUES (?, ?, ?, 'running', ?)`,
    [event.call_id, event.session_id, event.tool_name, event.created_at_ms],
  );
}

function handleToolExecuteAfter(
  event: ToolExecuteAfterEvent,
  txn: TransactionContext,
): void {
  const callId = event.call_id;
  const toolName = event.tool_name;
  const title = event.title;
  const durationMs = event.duration_ms;

  // Check if the tool call record exists
  const existing = txn.get(
    "SELECT call_id FROM projection_tool_calls WHERE call_id = ?",
    [callId],
  );

  if (!existing) {
    // Insert new record if it doesn't exist (no prior tool.started event)
    txn.run(
      `INSERT OR IGNORE INTO projection_tool_calls
         (call_id, session_id, tool_name, status, started_at, completed_at, duration_ms, title)
       VALUES (?, ?, ?, 'completed', ?, ?, ?, ?)`,
      [
        callId,
        event.session_id,
        toolName,
        event.created_at_ms,
        event.created_at_ms,
        durationMs || null,
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
         title = COALESCE(?, title),
         projected_at = CURRENT_TIMESTAMP
     WHERE call_id = ?`,
    [event.created_at_ms, durationMs || null, title, callId],
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
        event.created_at_ms,
        event.created_at_ms,
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
    [event.created_at_ms, durationMs || null, errorMessage, callId],
  );
}

// ---------------------------------------------------------------------------
// Handler Export
// ---------------------------------------------------------------------------

const HANDLED_EVENTS: StatsEventType[] = [
  "tool.execute.before",
  "tool.execute.after",
  "tool.failed",
];

export const toolCallHandler: ProjectionHandler = {
  handles: HANDLED_EVENTS,

  handle(event: StatsEvent, txn: TransactionContext): void {
    switch (event.event_type) {
      case "tool.execute.before":
        handleToolExecuteBefore(event, txn);
        break;
      case "tool.execute.after":
        handleToolExecuteAfter(event, txn);
        break;
      case "tool.failed":
        handleToolFailed(event, txn);
        break;
    }
  },
};
