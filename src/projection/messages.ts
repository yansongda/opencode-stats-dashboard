/**
 * MessagesProjectionHandler — inserts message.updated events into messages table.
 *
 * Only processes message.updated events (the only type with model information).
 * Each event becomes one row in the messages table (detail table, not aggregated).
 * Uses INSERT OR IGNORE with message_id for idempotency.
 */

import type { StatsEvent, StatsEventType } from "@defs/events";
import type { ProjectionHandler, TransactionContext } from "@defs/projections";
import { totalTokens } from "./utils";

const HANDLED_EVENTS: StatsEventType[] = ["message.updated"];

export const messagesHandler: ProjectionHandler = {
  handles: HANDLED_EVENTS,

  handle(event: StatsEvent, txn: TransactionContext): void {
    if (event.event_type !== "message.updated") return;

    if (!event.model && event.role === "assistant") return;

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
        event.role,
        event.agent ?? null,
        event.tokens.input,
        event.tokens.output,
        event.tokens.reasoning,
        event.tokens.cache.read,
        event.tokens.cache.write,
        total,
        event.cost_usd,
        event.lines_added,
        event.lines_deleted,
        event.files_changed,
        event.created_at_ms,
        event.completed_at_ms ?? null,
        event.duration_ms ?? null,
        event.finish_reason ?? null,
        event.has_error,
        event.error_type ?? null,
      ],
    );
  },
};
