/**
 * Idempotent event insertion into the `events` table.
 *
 * Uses `INSERT OR IGNORE` on the `event_id` primary key so that repeated
 * ingestion of the same event is safe.
 */

import { Database } from "bun:sqlite"
import type { IngestEventEnvelope } from "../types"

/** Result of an idempotent event insert. */
export type InsertResult = "accepted" | "duplicate"

/**
 * Insert an event into the `events` table idempotently.
 *
 * Uses `INSERT OR IGNORE` on the `event_id` primary key. Returns `"duplicate"`
 * when the `event_id` already exists.
 */
export function insertEvent(
  db: Database,
  event: IngestEventEnvelope
): InsertResult {
  const metadataJson = JSON.stringify(event.metadata ?? {})

  const result = db.run(
    `INSERT OR IGNORE INTO events (
        event_id, event_type, session_id, project_path,
        timestamp_ms, model, tokens, cost_usd,
        tool, status, summary, deleted, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      event.event_id,
      event.event_type,
      event.session_id,
      event.project_path,
      event.timestamp_ms,
      event.model,
      event.tokens,
      event.cost_usd,
      event.tool,
      event.status,
      event.summary,
      event.deleted ? 1 : 0,
      metadataJson,
    ]
  )

  return result.changes === 0 ? "duplicate" : "accepted"
}
