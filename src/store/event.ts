/**
 * Event Store — append-only event persistence layer.
 *
 * Provides idempotent writes (INSERT OR IGNORE) and query functions
 * with prepared statements for performance.
 *
 * Design principles (§3.2):
 *   - Immutability: events are never modified or deleted
 *   - Idempotency: duplicate event_id is silently ignored
 *   - Integrity: all original information preserved
 *   - Traceability: every event has timestamp + association
 */

import type { Database } from "bun:sqlite";
import type { StatsEvent } from "@defs/events";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Row shape returned by queries against the events table */
export interface EventRow {
  event_id: string;
  event_type: string;
  session_id: string;
  timestamp_ms: number;
  ingested_at: string;
  model: string | null;
  total_tokens: number;
  cost_usd: number;
  event_contents: string;
}

/** Filter options for getEvents / countEvents */
export interface EventQueryFilters {
  session_id?: string;
  event_type?: string;
  start_ms?: number;
  end_ms?: number;
  limit?: number;
  offset?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build WHERE clause fragments + params from filters.
 * Returns [whereSql, params] — whereSql is empty string if no conditions.
 */
function buildWhere(filters?: EventQueryFilters): [string, unknown[]] {
  if (!filters) return ["", []];

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.session_id !== undefined) {
    conditions.push("session_id = ?");
    params.push(filters.session_id);
  }
  if (filters.event_type !== undefined) {
    conditions.push("event_type = ?");
    params.push(filters.event_type);
  }
  if (filters.start_ms !== undefined) {
    conditions.push("timestamp_ms >= ?");
    params.push(filters.start_ms);
  }
  if (filters.end_ms !== undefined) {
    conditions.push("timestamp_ms <= ?");
    params.push(filters.end_ms);
  }

  const whereSql =
    conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
  return [whereSql, params];
}

// ---------------------------------------------------------------------------
// EventStore
// ---------------------------------------------------------------------------

export class EventStore {
  private db: Database;
  private stmtInsert: ReturnType<Database["query"]>;
  private stmtGetById: ReturnType<Database["query"]>;

  constructor(db: Database) {
    this.db = db;

    // Prepared statement: INSERT OR IGNORE for idempotent writes
    this.stmtInsert = db.query(`
      INSERT OR IGNORE INTO events
        (event_id, event_type, session_id, timestamp_ms, model, total_tokens, cost_usd, event_contents)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Prepared statement: single event lookup by PK
    this.stmtGetById = db.query("SELECT * FROM events WHERE event_id = ?");
  }

  /**
   * Insert a single event. Idempotent — returns false if event_id already exists.
   *
   * @returns true if inserted, false if duplicate (ignored)
   */
  insertEvent(event: StatsEvent): boolean {
    const session_id = "session_id" in event ? event.session_id : "";
    const model = "model" in event ? event.model : "";
    const tokens =
      "tokens" in event && event.tokens
        ? typeof event.tokens === "number"
          ? event.tokens
          : event.tokens.input + event.tokens.output + event.tokens.reasoning
        : 0;
    const cost_usd = "cost_usd" in event ? event.cost_usd : 0;

    const { event_id, event_type, timestamp_ms, ...rest } = event;
    const result = this.stmtInsert.run(
      event_id,
      event_type,
      session_id,
      timestamp_ms,
      model,
      tokens,
      cost_usd,
      JSON.stringify(rest),
    );
    return result.changes === 1;
  }

  /**
   * Insert multiple events in a single transaction.
   *
   * @returns count of events actually inserted (duplicates skipped)
   */
  insertEvents(events: StatsEvent[]): number {
    if (events.length === 0) return 0;

    let inserted = 0;
    const tx = this.db.transaction(() => {
      for (const event of events) {
        if (this.insertEvent(event)) {
          inserted++;
        }
      }
    });
    tx();
    return inserted;
  }

  /**
   * Retrieve a single event by its primary key.
   *
   * @returns event row or null if not found
   */
  getEventById(eventId: string): EventRow | null {
    return (this.stmtGetById.get(eventId) as EventRow) ?? null;
  }

  /**
   * Query events with optional filters.
   *
   * Results ordered by timestamp_ms ASC.
   * Supports limit + offset for pagination.
   */
  getEvents(filters?: EventQueryFilters): EventRow[] {
    const [whereSql, params] = buildWhere(filters);

    let sql = `SELECT * FROM events${whereSql} ORDER BY timestamp_ms ASC`;

    if (filters?.limit !== undefined) {
      sql += ` LIMIT ?`;
      params.push(filters.limit);
    }
    if (filters?.offset !== undefined) {
      sql += ` OFFSET ?`;
      params.push(filters.offset);
    }

    // biome-ignore lint/suspicious/noExplicitAny: bun:sqlite API requires specific binding type
    return this.db.query(sql).all(...(params as any)) as EventRow[];
  }

  /**
   * Count events matching optional filters.
   */
  countEvents(filters?: EventQueryFilters): number {
    const [whereSql, params] = buildWhere(filters);
    const sql = `SELECT COUNT(*) as cnt FROM events${whereSql}`;
    // biome-ignore lint/suspicious/noExplicitAny: bun:sqlite API requires specific binding type
    const row = this.db.query(sql).get(...(params as any)) as { cnt: number };
    return row.cnt;
  }
}
