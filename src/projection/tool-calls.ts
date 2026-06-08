/**
 * tool_calls handler — tracks individual tool call lifecycle.
 *
 * Processes:
 *  - tool.execute.before → INSERT row with started_at timestamp
 *  - tool.execute.after  → UPDATE row with status='completed'
 *  - tool.failed         → UPDATE row with status='error'
 *
 * Design doc: §4.3 tool_calls
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
    `INSERT OR IGNORE INTO tool_calls
       (call_id, session_id, tool_name, status, started_at_ms)
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

  const existing = txn.get(
    "SELECT call_id, started_at_ms FROM tool_calls WHERE call_id = ?",
    [callId],
  );

  if (!existing) {
    txn.run(
      `INSERT OR IGNORE INTO tool_calls
         (call_id, session_id, tool_name, status, started_at_ms, completed_at_ms, duration_ms, title)
       VALUES (?, ?, ?, 'completed', ?, ?, ?, ?)`,
      [
        callId,
        event.session_id,
        toolName,
        event.created_at_ms,
        event.created_at_ms,
        event.duration_ms || null,
        title,
      ],
    );
    return;
  }

  const durationMs =
    event.duration_ms ||
    event.created_at_ms - (existing.started_at_ms as number);

  txn.run(
    `UPDATE tool_calls
     SET status = 'completed',
         completed_at_ms = ?,
         duration_ms = ?,
         title = COALESCE(?, title),
         updated_at = CURRENT_TIMESTAMP
     WHERE call_id = ?`,
    [event.created_at_ms, durationMs, title, callId],
  );
}

function handleToolFailed(
  event: ToolFailedEvent,
  txn: TransactionContext,
): void {
  const callId = event.call_id;
  const errorMessage = event.error_message;

  const existing = txn.get(
    "SELECT call_id, started_at_ms FROM tool_calls WHERE call_id = ?",
    [callId],
  );

  if (!existing) {
    txn.run(
      `INSERT OR IGNORE INTO tool_calls
         (call_id, session_id, tool_name, status, started_at_ms, completed_at_ms, duration_ms, error_message)
       VALUES (?, ?, ?, 'error', ?, ?, ?, ?)`,
      [
        callId,
        event.session_id,
        event.tool_name,
        event.created_at_ms,
        event.created_at_ms,
        event.duration_ms || null,
        errorMessage,
      ],
    );
    return;
  }

  const durationMs =
    event.duration_ms ||
    event.created_at_ms - (existing.started_at_ms as number);

  txn.run(
    `UPDATE tool_calls
     SET status = 'error',
         completed_at_ms = ?,
         duration_ms = ?,
         error_message = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE call_id = ?`,
    [event.created_at_ms, durationMs, errorMessage, callId],
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
