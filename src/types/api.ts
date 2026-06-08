/**
 * API request/response type definitions for the Event-Sourced Stats Engine.
 *
 * REST API endpoints for querying stats, sessions, tools, models, and projects.
 */

import type { ModelUsage } from "@defs/projections";
import type { Hono } from "hono";

// ============================================================================
// API Handler Types
// ============================================================================

/**
 * A route registrar function that mounts its routes onto the Hono app.
 * Used by handler modules (stats, stream, ingest, etc.)
 */
export type RouteRegistrar = (app: Hono) => void;

// ============================================================================
// Common Types
// ============================================================================

/** Time range for queries */
export interface TimeRange {
  start: number;
  end: number;
}

/** Sort order */
export type SortOrder = "asc" | "desc";

/** Group by dimensions */
export type GroupByDimension = "date" | "project" | "model" | "agent";

/** Pagination parameters */
export interface PaginationParams {
  limit?: number;
  offset?: number;
}

/** Standard API response wrapper */
export interface ApiResponse<T> {
  data: T;
  meta?: {
    total?: number;
    limit?: number;
    offset?: number;
  };
}

/** API error response */
export interface ApiError {
  error: string;
  message?: string;
  code?: string;
}

// ============================================================================
// Query Parameters
// ============================================================================

/** Stats query parameters */
export interface StatsQuery {
  /** Time range */
  timeRange?: TimeRange;

  /** Filter conditions */
  filters?: {
    project?: string;
    model?: string;
    status?: string;
    agent?: string;
  };

  /** Aggregation dimensions */
  groupBy?: GroupByDimension[];

  /** Sort field */
  sortBy?: string;

  /** Sort order */
  sortOrder?: SortOrder;

  /** Pagination */
  limit?: number;
  offset?: number;
}

// ============================================================================
// Overview Endpoint
// ============================================================================

/** Overview stats response */
export interface OverviewStats {
  /** Total sessions */
  total_sessions: number;
  active_sessions: number;
  deleted_sessions: number;

  /** Total tokens */
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cache_read: number;
  cache_write: number;

  /** Total cost */
  total_cost_usd: number;

  /** Tool stats */
  tool_call_count: number;
  tool_error_count: number;

  /** File stats */
  files_edited: number;
  lines_added: number;
  lines_deleted: number;

  /** Error stats */
  error_count: number;

  /** Time stats */
  first_event_at: number | null;
  last_event_at: number | null;
}

// ============================================================================
// Trend Endpoint
// ============================================================================

/** Trend data point */
export interface TrendDataPoint {
  date: string;
  tokens: number;
  cost_usd: number;
}

/** Trend response */
export interface TrendResponse {
  granularity: "day" | "week" | "month";
  data: TrendDataPoint[];
}

// ============================================================================
// Sessions Endpoint
// ============================================================================

/** Session list item */
export interface SessionListItem {
  session_id: string;
  project_path: string | null;
  title: string | null;
  status: "active" | "deleted";
  primary_model: string | null;
  total_tokens: number;
  total_cost_usd: number;
  duration_ms: number | null;
  last_event_at: number | null;
  event_count: number;
}

/** Session detail */
export interface SessionDetail extends SessionListItem {
  // Model usage
  model_usage: ModelUsage | null;

  // Time stats
  first_event_at: number | null;

  // Message stats
  user_message_count: number;
  assistant_message_count: number;

  // Token breakdown
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cache_read: number;
  cache_write: number;

  // Tool stats
  tool_call_count: number;
  tool_error_count: number;

  // File stats
  files_edited: number;
  lines_added: number;
  lines_deleted: number;

  // Error stats
  error_count: number;
}

/** Sessions list response */
export interface SessionsListResponse {
  sessions: SessionListItem[];
  total: number;
}

// ============================================================================
// Tools Endpoint
// ============================================================================

/** Tool stats item */
export interface ToolStatsItem {
  tool_name: string;
  call_count: number;
  error_count: number;
  success_rate: number;
  avg_duration_ms: number;
}

/** Tools stats response */
export interface ToolsStatsResponse {
  tools: ToolStatsItem[];
  total_calls: number;
  total_errors: number;
  success_rate: number;
}

// ============================================================================
// Models Endpoint
// ============================================================================

/** Model comparison item */
export interface ModelComparisonItem {
  model: string;
  session_count: number;
  message_count: number;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  total_cost_usd: number;
  avg_cost_per_session: number;
}

/** Models comparison response */
export interface ModelsComparisonResponse {
  models: ModelComparisonItem[];
  total_cost_usd: number;
}

// ============================================================================
// Projects Endpoint
// ============================================================================

/** Project stats item */
export interface ProjectStatsItem {
  project_path: string;
  session_count: number;
  total_tokens: number;
  total_cost_usd: number;
  last_event_at: number | null;
  primary_model: string | null;
}

/** Projects stats response */
export interface ProjectsStatsResponse {
  projects: ProjectStatsItem[];
  total_cost_usd: number;
}

// ============================================================================
// Errors Endpoint
// ============================================================================

/** Error stats item */
export interface ErrorStatsItem {
  error_type: string;
  count: number;
  last_occurrence: number;
  session_ids: string[];
}

/** Errors stats response */
export interface ErrorsStatsResponse {
  errors: ErrorStatsItem[];
  total_errors: number;
}

// ============================================================================
// Ingest Endpoint
// ============================================================================

/** Ingest request */
export interface IngestRequest {
  events: Array<{
    event_id: string;
    event_type: string;
    session_id: string;
    project_path: string;
    timestamp_ms: number;
    model: string;
    tokens: number;
    cost_usd: number;
    tool: string | null;
    status: string | null;
    summary: string | null;
    deleted: boolean;
    metadata: Record<string, unknown>;
  }>;
}

/** Ingest response */
export interface IngestResponse {
  accepted: number;
  rejected: number;
  duplicates: number;
  event_ids: string[];
}
