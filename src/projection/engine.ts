/**
 * Projection Engine — routes events to registered handlers inside transactions.
 *
 * Responsibilities:
 *  - Route events by event_type to matching handlers
 *  - Wrap handler execution in db.transaction() for atomicity
 *  - Skip already-processed events (idempotency)
 *
 * Does NOT implement specific projection logic — that's the handlers' job.
 */

import type { Database } from "bun:sqlite";
import type { StatsEvent, StatsEventType } from "@defs/events";
import type { ProjectionHandler, TransactionContext } from "@defs/projections";

// ---------------------------------------------------------------------------
// Transaction Context Implementation
// ---------------------------------------------------------------------------

/**
 * Creates a TransactionContext backed by the given Database.
 *
 * All queries run through this context are part of the enclosing transaction.
 */
function createTransactionContext(db: Database): TransactionContext {
  return {
    run(sql: string, params?: unknown[]): void {
      // biome-ignore lint/suspicious/noExplicitAny: bun:sqlite API requires specific binding type
      db.run(sql, params as any);
    },

    query<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[] {
      // biome-ignore lint/suspicious/noExplicitAny: bun:sqlite API requires specific binding type
      return db.query(sql).all(...((params ?? []) as any)) as T[];
    },

    get<T = Record<string, unknown>>(
      sql: string,
      params?: unknown[],
    ): T | null {
      // biome-ignore lint/suspicious/noExplicitAny: bun:sqlite API requires specific binding type
      return (db.query(sql).get(...((params ?? []) as any)) as T) ?? null;
    },
  };
}

// ---------------------------------------------------------------------------
// Projection Engine
// ---------------------------------------------------------------------------

/**
 * Entry for a registered handler.
 */
interface HandlerEntry {
  name: string;
  handler: ProjectionHandler;
}

export class ProjectionEngine {
  private readonly db: Database;
  private readonly handlers = new Map<string, HandlerEntry>();
  private readonly processedEvents = new Set<string>();

  /** Maximum number of event IDs to keep in memory for idempotency. */
  private static readonly MAX_PROCESSED = 10_000;

  constructor(db: Database) {
    this.db = db;
  }

  // =========================================================================
  // Handler Registration
  // =========================================================================

  /**
   * Register a projection handler under a unique name.
   *
   * @throws If a handler with the same name is already registered.
   */
  registerHandler(name: string, handler: ProjectionHandler): void {
    if (this.handlers.has(name)) {
      throw new Error(`Handler "${name}" is already registered`);
    }
    this.handlers.set(name, { name, handler });
  }

  /**
   * Check if a handler with the given name is registered.
   */
  hasHandler(name: string): boolean {
    return this.handlers.has(name);
  }

  /**
   * Return all registered handler names.
   */
  getHandlerNames(): string[] {
    return [...this.handlers.keys()];
  }

  // =========================================================================
  // Event Processing
  // =========================================================================

  /**
   * Process a single event through matching handlers.
   *
   * Steps:
   *  1. Check idempotency — skip if event_id already processed
   *  2. Find handlers whose `handles` array includes the event_type
   *  3. Execute each matching handler inside a transaction
   *  4. Mark event_id as processed on success
   *
   * If any handler throws, the transaction rolls back and the event
   * is NOT marked as processed (so it can be retried).
   */
  processEvent(event: StatsEvent): void {
    // Evict old entries when capacity is exceeded — relies on EventStore's
    // INSERT OR IGNORE for true idempotency at the persistence layer.
    if (this.processedEvents.size >= ProjectionEngine.MAX_PROCESSED) {
      this.processedEvents.clear();
    }

    // Idempotency check
    if (this.processedEvents.has(event.event_id)) {
      return;
    }

    // Find matching handlers
    const matching = this.findMatchingHandlers(event.event_type);
    if (matching.length === 0) {
      return;
    }

    const txn = this.db.transaction(() => {
      const ctx = createTransactionContext(this.db);
      for (const entry of matching) {
        entry.handler.handle(event, ctx);
      }
    });

    try {
      txn();
      // Mark as processed only after a successful commit so failed events
      // can be retried (e.g. transient SQLite lock).
      this.processedEvents.add(event.event_id);
    } catch (err) {
      // Surface the failure so it is debuggable; do NOT rethrow — callers
      // (and existing tests) rely on processEvent not propagating handler
      // errors so that subsequent events still get processed.
      console.error(
        `[projection] handler failed for event ${event.event_id} (${event.event_type}):`,
        err,
      );
    }
  }

  // =========================================================================
  // Internal
  // =========================================================================

  /**
   * Find all handlers whose `handles` array includes the given event_type.
   */
  private findMatchingHandlers(eventType: StatsEventType): HandlerEntry[] {
    const result: HandlerEntry[] = [];
    for (const entry of this.handlers.values()) {
      if (entry.handler.handles.includes(eventType)) {
        result.push(entry);
      }
    }
    return result;
  }
}
