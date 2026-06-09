/**
 * Session Projection Handler — processes events into session rows.
 *
 * Handles:
 *  - session.created:  create session record
 *  - session.updated:  update title + timestamp
 *  - session.deleted:  update status + timestamp
 *  - session.error:    update timestamp only
 *  - message.updated:  update timestamp only
 *  - tool.execute.after / tool.failed: update timestamp only
 */

import type {
  MessageUpdatedEvent,
  SessionCreatedEvent,
  SessionDeletedEvent,
  SessionErrorEvent,
  SessionUpdatedEvent,
  StatsEvent,
  StatsEventType,
  ToolExecuteAfterEvent,
  ToolFailedEvent,
} from "@defs/events";
import type { ProjectionHandler, TransactionContext } from "@defs/projections";

// ---------------------------------------------------------------------------
// Session Existence Guard
// ---------------------------------------------------------------------------

function ensureSessionExists(
  event: { session_id: string; project_path: string; created_at_ms: number },
  txn: TransactionContext,
): void {
  const existing = txn.get(
    "SELECT session_id FROM sessions WHERE session_id = ?",
    [event.session_id],
  );
  if (!existing) {
    txn.run(
      `INSERT OR IGNORE INTO sessions
        (session_id, project_path, title, status, first_event_at_ms, last_event_at_ms)
       VALUES (?, ?, '', 'active', ?, ?)`,
      [
        event.session_id,
        event.project_path,
        event.created_at_ms,
        event.created_at_ms,
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Event Handlers
// ---------------------------------------------------------------------------

function handleSessionCreated(
  event: SessionCreatedEvent,
  txn: TransactionContext,
): void {
  txn.run(
    `INSERT OR IGNORE INTO sessions
      (session_id, project_path, title, status, first_event_at_ms, last_event_at_ms)
     VALUES (?, ?, ?, 'active', ?, ?)`,
    [
      event.session_id,
      event.project_path,
      event.title,
      event.created_at_ms,
      event.created_at_ms,
    ],
  );
}

function handleSessionUpdated(
  event: SessionUpdatedEvent,
  txn: TransactionContext,
): void {
  txn.run(
    `UPDATE sessions
       SET title = ?, last_event_at_ms = ?, duration_ms = ? - first_event_at_ms
       WHERE session_id = ?`,
    [event.title, event.created_at_ms, event.created_at_ms, event.session_id],
  );
}

function handleSessionDeleted(
  event: SessionDeletedEvent,
  txn: TransactionContext,
): void {
  txn.run(
    `UPDATE sessions
       SET status = 'deleted', deleted_at_ms = ?, last_event_at_ms = ?, duration_ms = ? - first_event_at_ms
       WHERE session_id = ?`,
    [
      event.created_at_ms,
      event.created_at_ms,
      event.created_at_ms,
      event.session_id,
    ],
  );
}

function handleSessionError(
  event: SessionErrorEvent,
  txn: TransactionContext,
): void {
  txn.run(
    `UPDATE sessions
       SET last_event_at_ms = ?, duration_ms = ? - first_event_at_ms
       WHERE session_id = ?`,
    [event.created_at_ms, event.created_at_ms, event.session_id],
  );
}

function handleMessageUpdated(
  event: MessageUpdatedEvent,
  txn: TransactionContext,
): void {
  ensureSessionExists(event, txn);
  txn.run(
    `UPDATE sessions
       SET last_event_at_ms = ?, duration_ms = ? - first_event_at_ms
       WHERE session_id = ?`,
    [event.created_at_ms, event.created_at_ms, event.session_id],
  );
}

function handleToolExecuteAfter(
  event: ToolExecuteAfterEvent | ToolFailedEvent,
  txn: TransactionContext,
): void {
  ensureSessionExists(event, txn);
  txn.run(
    `UPDATE sessions
       SET last_event_at_ms = ?, duration_ms = ? - first_event_at_ms
       WHERE session_id = ?`,
    [event.created_at_ms, event.created_at_ms, event.session_id],
  );
}

// ---------------------------------------------------------------------------
// Handler Factory
// ---------------------------------------------------------------------------

const HANDLED_EVENTS: StatsEventType[] = [
  "session.created",
  "session.updated",
  "session.deleted",
  "session.error",
  "message.updated",
  "tool.execute.after",
  "tool.failed",
];

export function createSessionProjectionHandler(): ProjectionHandler {
  return {
    handles: HANDLED_EVENTS,

    handle(event: StatsEvent, txn: TransactionContext): void {
      switch (event.event_type) {
        case "session.created":
          handleSessionCreated(event, txn);
          break;

        case "session.updated":
          handleSessionUpdated(event, txn);
          break;

        case "session.deleted":
          handleSessionDeleted(event, txn);
          break;

        case "session.error":
          handleSessionError(event, txn);
          break;

        case "message.updated":
          handleMessageUpdated(event, txn);
          break;

        case "tool.execute.after":
        case "tool.failed":
          handleToolExecuteAfter(event, txn);
          break;

        default:
          break;
      }
    },
  };
}
