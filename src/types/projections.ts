/**
 * Projection type definitions for the Event-Sourced Stats Engine.
 *
 * Projections are materialized views derived from events.
 * Three main projections: sessions, messages, and tool_calls.
 */

import type { StatsEvent, StatsEventType, TokenBreakdown } from "@defs/events";

// ============================================================================
// Transaction Context
// ============================================================================

/**
 * Thin wrapper around Database methods available inside a transaction.
 *
 * All queries run through this context are part of the same transaction —
 * if the handler throws, everything rolls back automatically.
 */
export interface TransactionContext {
  /** Execute a SQL statement (INSERT, UPDATE, DELETE) */
  run(sql: string, params?: unknown[]): void;

  /** Execute a query and return all rows */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[];

  /** Execute a query and return the first row, or null */
  get<T = Record<string, unknown>>(sql: string, params?: unknown[]): T | null;
}

// ============================================================================
// Projection Handler
// ============================================================================

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
  handles: StatsEventType[];

  /**
   * Process a single event within a transaction.
   *
   * @param event - The event envelope to process
   * @param txn - Transaction context for database operations
   * @throws If the handler fails, the entire transaction rolls back
   */
  handle(event: StatsEvent, txn: TransactionContext): void;
}

// ============================================================================
// Shared Types
// ============================================================================

/** Model usage statistics per model */
export interface ModelUsageEntry {
  message_count: number;
  tokens: TokenBreakdown;
  cost_usd: number;
}

/** Model usage map: model name -> usage stats */
export type ModelUsage = Record<string, ModelUsageEntry>;

// ============================================================================
// sessions
// ============================================================================

export interface ProjectionSession {
  // Primary key
  session_id: string;

  // Basic info
  project_path: string | null;
  title: string | null;

  // Status
  status: "active" | "deleted";
  deleted_at_ms: number | null;

  // Time dimensions
  first_event_at_ms: number | null;
  last_event_at_ms: number | null;
  duration_ms: number | null;

  // Projection metadata
  created_at: string;
}

// ============================================================================
// tool_calls
// ============================================================================

export type ToolCallStatus = "pending" | "running" | "completed" | "error";

export interface ProjectionToolCall {
  // Primary key
  call_id: string;
  session_id: string;

  // Tool info
  tool_name: string;

  // Status
  status: ToolCallStatus;

  // Time
  started_at_ms: number | null;
  completed_at_ms: number | null;
  duration_ms: number | null;

  // Token stats
  input_tokens: number;
  output_tokens: number;
  cache_read: number;
  cache_write: number;

  // Cost stats
  cost_usd: number;

  // Result
  title: string | null;
  error_message: string | null;

  // Projection metadata
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Daily Aggregate Types
// ============================================================================

/** Daily aggregate by model */
export interface DailyAggregateByModel {
  total: number;
  input: number;
  output: number;
  reasoning: number;
  cache: {
    read: number;
    write: number;
  };
}

/** Daily aggregate tokens */
export interface DailyAggregateTokens {
  total: number;
  input: number;
  output: number;
  reasoning: number;
  cache: {
    read: number;
    write: number;
  };
  by_model: Record<string, DailyAggregateByModel>;
}

/** Daily aggregate cost */
export interface DailyAggregateCost {
  total: number;
  by_model: Record<string, number>;
}

/** Daily aggregate tools */
export interface DailyAggregateTools {
  total_calls: number;
  errors: number;
  by_tool: Record<string, number>;
}

/** Daily aggregate files */
export interface DailyAggregateFiles {
  edited: number;
  lines_added: number;
  lines_deleted: number;
}

/** Daily aggregate errors */
export interface DailyAggregateErrors {
  total: number;
  by_type: Record<string, number>;
}

/** Daily aggregate sessions */
export interface DailyAggregateSessions {
  total: number;
  active: number;
  deleted: number;
}

/** Daily aggregate messages */
export interface DailyAggregateMessages {
  total: number;
  user: number;
  assistant: number;
}
