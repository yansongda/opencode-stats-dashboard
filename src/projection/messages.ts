/**
 * MessagesProjectionHandler — inserts message.updated events into messages table.
 *
 * Only processes message.updated events (the only type with model information).
 * Each event becomes one row in the messages table (detail table, not aggregated).
 * Uses INSERT OR IGNORE with message_id for idempotency.
 */

import type {
  MessageUpdatedEvent,
  StatsEvent,
  StatsEventType,
  TokenBreakdown,
} from "@defs/events";
import type { ProjectionHandler, TransactionContext } from "@defs/projections";

function totalTokens(tokens: TokenBreakdown): number {
  return (
    tokens.input +
    tokens.output +
    tokens.reasoning +
    tokens.cache.read +
    tokens.cache.write
  );
}

export class MessagesProjectionHandler implements ProjectionHandler {
  readonly handles: StatsEventType[] = ["message.updated"];

  handle(event: StatsEvent, txn: TransactionContext): void {
    if (event.event_type !== "message.updated") return;

    const e = event as MessageUpdatedEvent;
    if (!e.model && e.role === "assistant") return;

    const total = totalTokens(e.tokens);

    txn.run(
      `INSERT OR IGNORE INTO messages (
        message_id, event_id, session_id, project_path, model, role, agent,
        input_tokens, output_tokens, reasoning_tokens, cache_read, cache_write, total_tokens,
        cost_usd, lines_added, lines_deleted, files_changed,
        created_at_ms, completed_at_ms, duration_ms,
        finish_reason, has_error, error_type
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        e.message_id,
        e.event_id,
        e.session_id,
        e.project_path,
        e.model,
        e.role,
        e.agent ?? null,
        e.tokens.input,
        e.tokens.output,
        e.tokens.reasoning,
        e.tokens.cache.read,
        e.tokens.cache.write,
        total,
        e.cost_usd,
        e.lines_added,
        e.lines_deleted,
        e.files_changed,
        e.created_at_ms,
        e.completed_at_ms ?? null,
        e.duration_ms ?? null,
        e.finish_reason ?? null,
        e.has_error,
        e.error_type ?? null,
      ],
    );
  }
}

export const messagesProjectionHandler = new MessagesProjectionHandler();
