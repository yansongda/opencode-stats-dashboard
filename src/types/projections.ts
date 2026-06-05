/**
 * Projection type definitions for the Event-Sourced Stats Engine.
 *
 * Projections are materialized views derived from events.
 * Three main projections: sessions, daily, and tool_calls.
 */

import type { TokenBreakdown } from "./events.js"

// ============================================================================
// Shared Types
// ============================================================================

/** Model usage statistics per model */
export interface ModelUsageEntry {
  message_count: number
  tokens: TokenBreakdown
  cost_usd: number
}

/** Model usage map: model name -> usage stats */
export type ModelUsage = Record<string, ModelUsageEntry>

/** Agent usage statistics per agent */
export interface AgentUsageEntry {
  message_count: number
  tokens: TokenBreakdown
  cost_usd: number
}

/** Agent usage map: agent name -> usage stats */
export type AgentUsage = Record<string, AgentUsageEntry>

// ============================================================================
// projection_sessions
// ============================================================================

export interface ProjectionSession {
  // Primary key
  session_id: string

  // Basic info
  project_path: string | null
  title: string | null

  // Status
  status: "active" | "deleted"
  deleted_at: number | null

  // Model info
  primary_model: string | null
  model_usage: ModelUsage | null

  // Time dimensions
  first_event_at: number | null
  last_event_at: number | null
  duration_ms: number | null

  // Message stats
  user_message_count: number
  assistant_message_count: number

  // Token stats (session-level totals)
  total_tokens: number
  input_tokens: number
  output_tokens: number
  reasoning_tokens: number
  cache_read: number
  cache_write: number

  // Cost stats
  total_cost_usd: number

  // Tool stats
  tool_call_count: number
  tool_error_count: number

  // File stats
  files_edited: number
  lines_added: number
  lines_deleted: number

  // Agent stats
  primary_agent: string | null
  agent_usage: AgentUsage | null

  // Error stats
  error_count: number

  // Projection metadata
  projected_at: string
  event_count: number
}

// ============================================================================
// projection_daily
// ============================================================================

export interface ProjectionDaily {
  // Composite primary key
  date: string // YYYY-MM-DD
  project_path: string
  model: string

  // Session stats
  session_count: number
  active_sessions: number
  deleted_sessions: number

  // Message stats
  message_count: number
  user_messages: number
  assistant_messages: number

  // Token stats
  total_tokens: number
  input_tokens: number
  output_tokens: number
  reasoning_tokens: number
  cache_read: number
  cache_write: number

  // Cost stats
  total_cost_usd: number

  // Tool stats
  tool_calls: number
  tool_errors: number

  // File stats
  files_edited: number
  lines_added: number
  lines_deleted: number

  // Agent stats
  agent_usage: AgentUsage | null

  // Error stats
  error_count: number

  // Projection metadata
  projected_at: string
  event_count: number
}

// ============================================================================
// projection_tool_calls
// ============================================================================

export type ToolCallStatus = "pending" | "running" | "completed" | "error"

export interface ProjectionToolCall {
  // Primary key
  call_id: string
  session_id: string

  // Tool info
  tool_name: string

  // Status
  status: ToolCallStatus

  // Time
  started_at: number | null
  completed_at: number | null
  duration_ms: number | null

  // Token stats
  input_tokens: number
  output_tokens: number
  cache_read: number
  cache_write: number

  // Cost stats
  cost_usd: number

  // Result
  title: string | null
  error_message: string | null

  // Projection metadata
  projected_at: string
}

// ============================================================================
// Daily Aggregate Types
// ============================================================================

/** Daily aggregate by model */
export interface DailyAggregateByModel {
  total: number
  input: number
  output: number
  reasoning: number
  cache: {
    read: number
    write: number
  }
}

/** Daily aggregate tokens */
export interface DailyAggregateTokens {
  total: number
  input: number
  output: number
  reasoning: number
  cache: {
    read: number
    write: number
  }
  by_model: Record<string, DailyAggregateByModel>
}

/** Daily aggregate cost */
export interface DailyAggregateCost {
  total: number
  by_model: Record<string, number>
}

/** Daily aggregate tools */
export interface DailyAggregateTools {
  total_calls: number
  errors: number
  by_tool: Record<string, number>
}

/** Daily aggregate files */
export interface DailyAggregateFiles {
  edited: number
  lines_added: number
  lines_deleted: number
}

/** Daily aggregate agents */
export interface DailyAggregateAgents {
  [agent: string]: {
    sessions: number
    tokens: number
  }
}

/** Daily aggregate errors */
export interface DailyAggregateErrors {
  total: number
  by_type: Record<string, number>
}

/** Daily aggregate sessions */
export interface DailyAggregateSessions {
  total: number
  active: number
  deleted: number
}

/** Daily aggregate messages */
export interface DailyAggregateMessages {
  total: number
  user: number
  assistant: number
}
