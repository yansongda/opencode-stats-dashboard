/**
 * Session Projection Handler — processes events into projection_sessions rows.
 *
 * Handles:
 *  - session.created:  create session record
 *  - session.updated:  update title
 *  - session.deleted:  update status to deleted
 *  - message.updated:  update token/message stats, model_usage
 *  - tool.completed / tool.failed: update tool stats
 *  - session.error:    increment error_count
 *
 * Design doc: §4.1 — projection_sessions field source mapping.
 *
 * Type safety: uses type guards for JSON field parsing (no `as` assertions).
 */

import type {
  MessageUpdatedEvent,
  SessionCreatedEvent,
  SessionDeletedEvent,
  SessionErrorEvent,
  SessionUpdatedEvent,
  StatsEvent,
  StatsEventType,
  TokenBreakdown,
  ToolExecuteAfterEvent,
  ToolFailedEvent,
} from "@defs/events";
import type {
  ModelUsage,
  ModelUsageEntry,
  ProjectionHandler,
  TransactionContext,
} from "@defs/projections";
import { totalTokens } from "./utils";

// ---------------------------------------------------------------------------
// Type Guards (JSON field validation)
// ---------------------------------------------------------------------------

function isTokenBreakdown(data: unknown): data is TokenBreakdown {
  if (typeof data !== "object" || data === null) return false;
  const obj = data as Record<string, unknown>;
  return (
    typeof obj.input === "number" &&
    typeof obj.output === "number" &&
    typeof obj.reasoning === "number" &&
    typeof obj.cache === "object" &&
    obj.cache !== null &&
    typeof (obj.cache as Record<string, unknown>).read === "number" &&
    typeof (obj.cache as Record<string, unknown>).write === "number"
  );
}

function isModelUsageEntry(data: unknown): data is ModelUsageEntry {
  if (typeof data !== "object" || data === null) return false;
  const obj = data as Record<string, unknown>;
  return (
    typeof obj.message_count === "number" &&
    isTokenBreakdown(obj.tokens) &&
    typeof obj.cost_usd === "number"
  );
}

function isModelUsage(data: unknown): data is ModelUsage {
  if (typeof data !== "object" || data === null) return false;
  const obj = data as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!isModelUsageEntry(obj[key])) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// JSON Parse Helpers (with type guard validation)
// ---------------------------------------------------------------------------

function parseModelUsage(json: string | null | undefined): ModelUsage {
  if (!json) return {};
  try {
    const parsed: unknown = JSON.parse(json);
    if (isModelUsage(parsed)) return parsed;
    return {};
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Calculation Helpers
// ---------------------------------------------------------------------------

function updateModelUsage(
  current: ModelUsage,
  model: string,
  tokens: TokenBreakdown,
  cost: number,
): ModelUsage {
  const existing = current[model];
  const updated: ModelUsageEntry = existing
    ? {
        message_count: existing.message_count + 1,
        tokens: {
          input: existing.tokens.input + tokens.input,
          output: existing.tokens.output + tokens.output,
          reasoning: existing.tokens.reasoning + tokens.reasoning,
          cache: {
            read: existing.tokens.cache.read + tokens.cache.read,
            write: existing.tokens.cache.write + tokens.cache.write,
          },
        },
        cost_usd: existing.cost_usd + cost,
      }
    : {
        message_count: 1,
        tokens: { ...tokens },
        cost_usd: cost,
      };

  return { ...current, [model]: updated };
}

function calculatePrimaryModel(usage: ModelUsage): string | null {
  let best: string | null = null;
  let bestCount = 0;
  for (const [model, entry] of Object.entries(usage)) {
    if (entry.message_count > bestCount) {
      bestCount = entry.message_count;
      best = model;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Session Existence Guard
// ---------------------------------------------------------------------------

interface SessionIdentifiers {
  session_id: string;
  project_path: string;
  created_at_ms: number;
}

function ensureSessionExists(
  event: SessionIdentifiers,
  txn: TransactionContext,
): void {
  const existing = txn.get(
    "SELECT session_id FROM sessions WHERE session_id = ?",
    [event.session_id],
  );
  if (!existing) {
    txn.run(
      `INSERT OR IGNORE INTO sessions
        (session_id, project_path, title, status, first_event_at_ms, last_event_at_ms,
         model_usage, event_count)
       VALUES (?, ?, '', 'active', ?, ?, '{}', 0)`,
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
      (session_id, project_path, title, status, first_event_at_ms, last_event_at_ms,
       model_usage, event_count)
     VALUES (?, ?, ?, 'active', ?, ?, '{}', 1)`,
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
       SET title = ?, last_event_at_ms = ?, duration_ms = ? - first_event_at_ms, event_count = event_count + 1
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
       SET status = 'deleted', deleted_at_ms = ?, last_event_at_ms = ?, duration_ms = ? - first_event_at_ms, event_count = event_count + 1
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
       SET error_count = error_count + 1, last_event_at_ms = ?, duration_ms = ? - first_event_at_ms, event_count = event_count + 1
       WHERE session_id = ?`,
    [event.created_at_ms, event.created_at_ms, event.session_id],
  );
}

function handleMessageUpdated(
  event: MessageUpdatedEvent,
  txn: TransactionContext,
): void {
  ensureSessionExists(event, txn);

  const row = txn.get<{
    model_usage: string | null;
  }>("SELECT model_usage FROM sessions WHERE session_id = ?", [
    event.session_id,
  ]);
  if (!row) return;

  const tokens = event.tokens;

  if (event.role === "user") {
    txn.run(
      `UPDATE sessions
       SET user_message_count = user_message_count + 1,
           lines_added = lines_added + ?, lines_deleted = lines_deleted + ?,
           last_event_at_ms = ?, duration_ms = ? - first_event_at_ms, event_count = event_count + 1
       WHERE session_id = ?`,
      [
        event.lines_added,
        event.lines_deleted,
        event.created_at_ms,
        event.created_at_ms,
        event.session_id,
      ],
    );
  } else if (event.role === "assistant") {
    const modelUsage = parseModelUsage(row.model_usage);
    const updatedModelUsage = updateModelUsage(
      modelUsage,
      event.model,
      tokens,
      event.cost_usd,
    );
    const primaryModel = calculatePrimaryModel(updatedModelUsage);

    txn.run(
      `UPDATE sessions
       SET assistant_message_count = assistant_message_count + 1,
           total_tokens = total_tokens + ?,
           input_tokens = input_tokens + ?,
           output_tokens = output_tokens + ?,
           reasoning_tokens = reasoning_tokens + ?,
           cache_read = cache_read + ?,
           cache_write = cache_write + ?,
           total_cost_usd = total_cost_usd + ?,
           model_usage = ?,
           primary_model = ?,
           last_event_at_ms = ?, duration_ms = ? - first_event_at_ms, event_count = event_count + 1
       WHERE session_id = ?`,
      [
        totalTokens(tokens),
        tokens.input,
        tokens.output,
        tokens.reasoning,
        tokens.cache.read,
        tokens.cache.write,
        event.cost_usd,
        JSON.stringify(updatedModelUsage),
        primaryModel,
        event.created_at_ms,
        event.created_at_ms,
        event.session_id,
      ],
    );
  }
}

function handleToolExecuteAfter(
  event: ToolExecuteAfterEvent | ToolFailedEvent,
  txn: TransactionContext,
): void {
  ensureSessionExists(event, txn);
  const isError = event.event_type === "tool.failed";

  if (isError) {
    txn.run(
      `UPDATE sessions
       SET tool_call_count = tool_call_count + 1, tool_error_count = tool_error_count + 1, last_event_at_ms = ?, duration_ms = ? - first_event_at_ms, event_count = event_count + 1
       WHERE session_id = ?`,
      [event.created_at_ms, event.created_at_ms, event.session_id],
    );
  } else {
    txn.run(
      `UPDATE sessions
       SET tool_call_count = tool_call_count + 1, last_event_at_ms = ?, duration_ms = ? - first_event_at_ms, event_count = event_count + 1
       WHERE session_id = ?`,
      [event.created_at_ms, event.created_at_ms, event.session_id],
    );
  }
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

/**
 * Create a ProjectionHandler that materializes sessions.
 *
 * Exported as a factory function for testability and engine registration.
 */
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
