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

interface ToolCallBase {
  call_id: string;
  session_id: string;
  tool_name: string;
  created_at_ms: number;
  duration_ms: number;
}

function upsertToolCall(
  event: ToolCallBase,
  status: "completed" | "error",
  extra: { title?: string; error_message?: string },
  txn: TransactionContext,
): void {
  const existing = txn.get<{ started_at_ms: number }>(
    "SELECT started_at_ms FROM tool_calls WHERE call_id = ?",
    [event.call_id],
  );

  if (!existing) {
    txn.run(
      `INSERT OR IGNORE INTO tool_calls
         (call_id, session_id, tool_name, status, started_at_ms, completed_at_ms, duration_ms, title, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        event.call_id,
        event.session_id,
        event.tool_name,
        status,
        event.created_at_ms,
        event.created_at_ms,
        event.duration_ms || null,
        extra.title ?? null,
        extra.error_message ?? null,
      ],
    );
    return;
  }

  const durationMs =
    event.duration_ms || event.created_at_ms - existing.started_at_ms;

  txn.run(
    `UPDATE tool_calls
     SET status = ?,
         completed_at_ms = ?,
         duration_ms = ?,
         title = COALESCE(?, title),
         error_message = COALESCE(?, error_message),
         updated_at = CURRENT_TIMESTAMP
     WHERE call_id = ?`,
    [
      status,
      event.created_at_ms,
      durationMs,
      extra.title ?? null,
      extra.error_message ?? null,
      event.call_id,
    ],
  );
}

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
  upsertToolCall(event, "completed", { title: event.title }, txn);
}

function handleToolFailed(
  event: ToolFailedEvent,
  txn: TransactionContext,
): void {
  upsertToolCall(event, "error", { error_message: event.error_message }, txn);
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
