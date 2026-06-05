/**
 * Projection handler contract.
 *
 * Each handler declares which event_types it processes.
 * The engine routes events to matching handlers inside a transaction.
 */

import type { EventType, IngestEventEnvelope } from "../../types/events"

// ---------------------------------------------------------------------------
// Transaction Context
// ---------------------------------------------------------------------------

/**
 * Thin wrapper around Database methods available inside a transaction.
 *
 * All queries run through this context are part of the same transaction —
 * if the handler throws, everything rolls back automatically.
 */
export interface TransactionContext {
  /** Execute a SQL statement (INSERT, UPDATE, DELETE) */
  run(sql: string, params?: unknown[]): void

  /** Execute a query and return all rows */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[]

  /** Execute a query and return the first row, or null */
  get<T = Record<string, unknown>>(sql: string, params?: unknown[]): T | null
}

// ---------------------------------------------------------------------------
// Projection Handler
// ---------------------------------------------------------------------------

/**
 * A projection handler processes specific event types.
 *
 * @example
 * ```ts
 * const sessionHandler: ProjectionHandler = {
 *   handles: ["session.created", "session.updated"],
 *   handle: (event, txn) => {
 *     txn.run("INSERT INTO projection_sessions ...", [...])
 *   },
 * }
 * ```
 */
export interface ProjectionHandler {
  /** Event types this handler can process */
  handles: EventType[]

  /**
   * Process a single event within a transaction.
   *
   * @param event - The event envelope to process
   * @param txn - Transaction context for database operations
   * @throws If the handler fails, the entire transaction rolls back
   */
  handle(event: IngestEventEnvelope, txn: TransactionContext): void
}
