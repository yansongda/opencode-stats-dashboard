/**
 * MessagesProjectionHandler — inserts message events into messages table.
 *
 * Processes:
 *  - message.updated.user      → INSERT row (diff/line stats, no tokens)
 *  - message.updated.assistant → INSERT row (tokens/cost, model info)
 *
 * Each event becomes one row in the messages table (detail table, not aggregated).
 * Uses INSERT OR IGNORE with message_id for idempotency.
 */

import type {
  MessageUpdatedAssistantEvent,
  MessageUpdatedUserEvent,
  StatsEvent,
  StatsEventType,
} from "@defs/events";
import type { ProjectionHandler, TransactionContext } from "@defs/projections";
import { totalTokens } from "./utils";

const HANDLED_EVENTS: StatsEventType[] = [
  "message.updated.user",
  "message.updated.assistant",
];

// ---------------------------------------------------------------------------
// Event Handlers
// ---------------------------------------------------------------------------

function handleMessageUpdatedUser(
  event: MessageUpdatedUserEvent,
  txn: TransactionContext,
): void {
  txn.run(
    `INSERT OR REPLACE INTO messages (
      message_id, event_id, session_id, project_path, model, role, agent,
      input_tokens, output_tokens, reasoning_tokens, cache_read, cache_write, total_tokens,
      cost_usd, lines_added, lines_deleted, files_changed,
      created_at_ms, completed_at_ms, duration_ms,
      finish_reason, has_error, error_type
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      event.message_id,
      event.event_id,
      event.session_id,
      event.project_path,
      null, // model — user messages have no model
      event.role,
      event.agent ?? null,
      0,
      0,
      0,
      0,
      0,
      0, // tokens — user messages have no tokens
      0, // cost_usd
      event.lines_added,
      event.lines_deleted,
      event.files_changed,
      event.created_at_ms,
      null, // completed_at_ms
      null, // duration_ms
      null, // finish_reason
      0, // has_error
      null, // error_type
    ],
  );
}

function handleMessageUpdatedAssistant(
  event: MessageUpdatedAssistantEvent,
  txn: TransactionContext,
): void {
  if (!event.model) return;

  const total = totalTokens(event.tokens);

  txn.run(
    `INSERT OR REPLACE INTO messages (
      message_id, event_id, session_id, project_path, model, role, agent,
      input_tokens, output_tokens, reasoning_tokens, cache_read, cache_write, total_tokens,
      cost_usd, lines_added, lines_deleted, files_changed,
      created_at_ms, completed_at_ms, duration_ms,
      finish_reason, has_error, error_type
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      event.message_id,
      event.event_id,
      event.session_id,
      event.project_path,
      event.model,
      "assistant",
      event.agent ?? null,
      event.tokens.input,
      event.tokens.output,
      event.tokens.reasoning,
      event.tokens.cache.read,
      event.tokens.cache.write,
      total,
      event.cost_usd,
      0,
      0,
      0, // lines_added, lines_deleted, files_changed
      event.created_at_ms,
      event.completed_at_ms ?? null,
      event.duration_ms ?? null,
      event.finish_reason ?? null,
      event.has_error,
      event.error_type ?? null,
    ],
  );
}

// ---------------------------------------------------------------------------
// Handler Export
// ---------------------------------------------------------------------------

export const messagesHandler: ProjectionHandler = {
  handles: HANDLED_EVENTS,

  handle(event: StatsEvent, txn: TransactionContext): void {
    switch (event.event_type) {
      case "message.updated.user":
        handleMessageUpdatedUser(event, txn);
        break;
      case "message.updated.assistant":
        handleMessageUpdatedAssistant(event, txn);
        break;
    }
  },
};
