/**
 * API request/response type definitions for the Event-Sourced Stats Engine.
 *
 * Provides the /api/v1/dashboard/* page-level response contracts.
 */

import type { Hono } from "hono";

// ============================================================================
// API Handler Types
// ============================================================================

/**
 * A route registrar function that mounts its routes onto the Hono app.
 * Used by handler modules (dashboard, stream, ingest, etc.)
 */
export type RouteRegistrar = (app: Hono) => void;

/** Sort order */
export type SortOrder = "asc" | "desc";

// ============================================================================
// Dashboard API Response Contracts (/api/v1/dashboard/*)
// ============================================================================

// -- Response wrappers -------------------------------------------------------

export interface DashboardDataResponse<T> {
  data: T;
}

export interface DashboardListResponse<T> {
  data: T[];
  meta: {
    total: number;
    limit: number;
    offset: number;
  };
}

// -- 1. GET /api/v1/dashboard/overview ---------------------------------------

export interface DashboardOverviewSummary {
  total_sessions: number;
  active_sessions: number;
  deleted_sessions: number;
  total_messages: number;
  total_user_messages: number;
  total_assistant_messages: number;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cache_read: number;
  cache_write: number;
  total_cost_usd: number;
  total_tool_calls: number;
  total_tool_errors: number;
  total_errors: number;
  files_changed: number;
  lines_added: number;
  lines_deleted: number;
  total_projects: number;
  total_models: number;
  avg_tokens_per_session: number | null;
  avg_cost_per_session: number | null;
  avg_messages_per_session: number | null;
  avg_project_tokens: number | null;
  avg_project_cost: number | null;
  avg_project_messages: number | null;
  first_event_at_ms: number | null;
  last_event_at_ms: number | null;
}

export interface DashboardOverviewTrendPoint {
  date: string;
  sessions: number;
  messages: number;
  tokens: number;
  cost_usd: number;
  tool_calls: number;
  errors: number;
}

export interface DashboardOverviewRecentSession {
  session_id: string;
  project_path: string | null;
  title: string | null;
  status: "active" | "deleted";
  total_tokens: number;
  total_cost_usd: number;
  last_event_at_ms: number | null;
}

export interface DashboardOverviewTopModel {
  model: string;
  total_tokens: number;
  cost_usd: number;
  message_count: number;
}

export interface DashboardOverviewTopTool {
  tool_name: string;
  call_count: number;
  error_count: number;
  avg_duration_ms: number | null;
}

export interface DashboardOverviewProjectDistributionItem {
  project_path: string | null;
  session_count: number;
  cost_usd: number;
}

export interface DashboardOverviewData {
  summary: DashboardOverviewSummary;
  trend: DashboardOverviewTrendPoint[];
  heatmap: DashboardEfficiencyHeatmapPoint[];
  recent_sessions: DashboardOverviewRecentSession[];
  top_models: DashboardOverviewTopModel[];
  top_tools: DashboardOverviewTopTool[];
  model_message_distribution: Array<{
    model: string;
    message_count: number;
    percentage: number;
  }>;
  project_distribution: DashboardOverviewProjectDistributionItem[];
}

// -- 2. GET /api/v1/dashboard/efficiency -------------------------------------

export interface DashboardEfficiencySummary {
  total_sessions: number;
  total_messages: number;
  total_tokens: number;
  total_cost_usd: number;
  avg_session_duration_ms: number | null;
  avg_tokens_per_session: number | null;
  avg_cost_per_session: number | null;
  avg_messages_per_session: number | null;
  total_lines_added: number;
  total_lines_deleted: number;
  total_files_changed: number;
  tokens_per_usd: number | null;
  lines_changed_per_usd: number | null;
  messages_per_active_hour: number | null;
}

export interface DashboardEfficiencyTimelinePoint {
  bucket: string;
  sessions: number;
  messages: number;
  tokens: number;
  cost_usd: number;
  lines_added: number;
  lines_deleted: number;
  files_changed: number;
  avg_session_duration_ms: number | null;
}

export interface DashboardEfficiencyHeatmapPoint {
  weekday: number;
  hour: number;
  messages: number;
  tokens: number;
  cost_usd: number;
  tool_calls: number;
  errors: number;
}

export interface DashboardEfficiencyModelItem {
  model: string;
  messages: number;
  tokens: number;
  cost_usd: number;
  avg_tokens_per_message: number | null;
  cost_per_1k_tokens: number | null;
}

export interface DashboardEfficiencyData {
  summary: DashboardEfficiencySummary;
  timeline: DashboardEfficiencyTimelinePoint[];
  heatmap: DashboardEfficiencyHeatmapPoint[];
  model_efficiency: DashboardEfficiencyModelItem[];
}

// -- 3. GET /api/v1/dashboard/models -----------------------------------------

export interface DashboardModelsSummary {
  total_models: number;
  total_messages: number;
  total_tokens: number;
  total_cost_usd: number;
  top_model_by_tokens: string | null;
  top_model_by_cost: string | null;
  cheapest_model_per_1k_tokens: string | null;
}

export interface DashboardModelItem {
  model: string;
  message_count: number;
  session_count: number;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cache_read: number;
  cache_write: number;
  total_tokens: number;
  cost_usd: number;
  avg_tokens_per_message: number | null;
  avg_cost_per_message: number | null;
  cost_per_1k_tokens: number | null;
  associated_tool_call_count: number;
  error_count: number;
  error_rate: number | null;
  first_used_at_ms: number | null;
  last_used_at_ms: number | null;
}

export interface DashboardModelCostTrendPoint {
  date: string;
  model: string;
  tokens: number;
  cost_usd: number;
  messages: number;
}

export interface DashboardModelsData {
  summary: DashboardModelsSummary;
  models: DashboardModelItem[];
  cost_trend: DashboardModelCostTrendPoint[];
}

// -- 4. GET /api/v1/dashboard/projects ---------------------------------------

export interface DashboardProjectsSummary {
  total_projects: number;
  active_projects: number;
  total_sessions: number;
  total_messages: number;
  total_tokens: number;
  total_cost_usd: number;
  total_files_changed: number;
  total_lines_added: number;
  total_lines_deleted: number;
  top_project_by_tokens: string | null;
  top_project_by_cost: string | null;
  top_project_by_activity: string | null;
}

export interface DashboardProjectItem {
  project_path: string;
  session_count: number;
  message_count: number;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cache_read: number;
  cache_write: number;
  total_tokens: number;
  cost_usd: number;
  files_changed: number;
  lines_added: number;
  lines_deleted: number;
  tool_call_count: number;
  tool_error_count: number;
  error_count: number;
  primary_model: string | null;
  model_count: number;
  avg_tokens_per_session: number | null;
  avg_cost_per_session: number | null;
  avg_messages_per_session: number | null;
  first_event_at_ms: number | null;
  last_event_at_ms: number | null;
}

export interface DashboardProjectActivityTrendPoint {
  date: string;
  project_path: string;
  sessions: number;
  messages: number;
  tokens: number;
  cost_usd: number;
  files_changed: number;
  lines_added: number;
  lines_deleted: number;
}

export interface DashboardProjectModelUsageItem {
  project_path: string;
  model: string;
  sessions: number;
  messages: number;
  tokens: number;
  cost_usd: number;
}

export interface DashboardProjectsData {
  summary: DashboardProjectsSummary;
  projects: DashboardProjectItem[];
  activity_trend: DashboardProjectActivityTrendPoint[];
  project_model_usage: DashboardProjectModelUsageItem[];
}

// -- 5. GET /api/v1/dashboard/tools ------------------------------------------

export interface DashboardToolsSummary {
  total_tool_calls: number;
  completed_tool_calls: number;
  failed_tool_calls: number;
  running_tool_calls: number;
  tool_error_rate: number | null;
  avg_duration_ms: number | null;
  total_tools: number;
  most_used_tool: string | null;
  slowest_tool: string | null;
  most_error_prone_tool: string | null;
}

export interface DashboardToolItem {
  tool_name: string;
  call_count: number;
  completed_count: number;
  failed_count: number;
  running_count: number;
  error_rate: number | null;
  avg_duration_ms: number | null;
  min_duration_ms: number | null;
  max_duration_ms: number | null;
  first_used_at_ms: number | null;
  last_used_at_ms: number | null;
}

export interface DashboardToolTimelinePoint {
  date: string;
  tool_name: string;
  call_count: number;
  failed_count: number;
  avg_duration_ms: number | null;
}

export interface DashboardToolRecentError {
  call_id: string;
  session_id: string;
  tool_name: string;
  error_message: string;
  started_at_ms: number | null;
  completed_at_ms: number | null;
  duration_ms: number | null;
}

export interface DashboardToolsData {
  summary: DashboardToolsSummary;
  tools: DashboardToolItem[];
  timeline: DashboardToolTimelinePoint[];
  recent_errors: DashboardToolRecentError[];
}

// -- 6. GET /api/v1/dashboard/sessions ---------------------------------------

export interface DashboardSessionListItem {
  session_id: string;
  project_path: string | null;
  title: string | null;
  status: "active" | "deleted";
  message_count: number;
  user_message_count: number;
  assistant_message_count: number;
  total_tokens: number;
  total_cost_usd: number;
  tool_call_count: number;
  tool_error_count: number;
  error_count: number;
  files_changed: number;
  lines_added: number;
  lines_deleted: number;
  primary_model: string | null;
  model_count: number;
  first_event_at_ms: number | null;
  last_event_at_ms: number | null;
  duration_ms: number | null;
}

// -- 7. GET /api/v1/dashboard/sessions/:id -----------------------------------

export interface DashboardSessionDetailSummary {
  session_id: string;
  project_path: string | null;
  title: string | null;
  status: "active" | "deleted";
  message_count: number;
  user_message_count: number;
  assistant_message_count: number;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cache_read: number;
  cache_write: number;
  total_cost_usd: number;
  tool_call_count: number;
  tool_error_count: number;
  error_count: number;
  files_changed: number;
  lines_added: number;
  lines_deleted: number;
  primary_model: string | null;
  model_count: number;
  first_event_at_ms: number | null;
  last_event_at_ms: number | null;
  duration_ms: number | null;
}

export interface DashboardSessionMessageMetadata {
  message_id: string;
  event_id: string;
  role: "user" | "assistant";
  model: string | null;
  agent: string | null;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cache_read: number;
  cache_write: number;
  total_tokens: number;
  cost_usd: number;
  lines_added: number;
  lines_deleted: number;
  files_changed: number;
  created_at_ms: number;
  completed_at_ms: number | null;
  duration_ms: number | null;
  has_error: number;
  error_type: string | null;
}

export interface DashboardSessionModelUsage {
  model: string;
  message_count: number;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cache_read: number;
  cache_write: number;
  total_tokens: number;
  cost_usd: number;
}

export interface DashboardSessionToolCall {
  call_id: string;
  tool_name: string;
  status: string | null;
  title: string | null;
  error_message: string | null;
  started_at_ms: number | null;
  completed_at_ms: number | null;
  duration_ms: number | null;
}

export interface DashboardSessionError {
  event_id: string;
  event_type: string;
  created_at_ms: number;
  message: string;
  error_type?: string;
}

export interface DashboardSessionDetailData {
  session: DashboardSessionDetailSummary;
  messages: DashboardSessionMessageMetadata[];
  model_usage: DashboardSessionModelUsage[];
  tool_calls: DashboardSessionToolCall[];
  errors: DashboardSessionError[];
}
