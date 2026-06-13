/**
 * 事件溯源统计引擎的事件类型定义
 *
 * 每个事件 1:1 映射到上游 opencode SDK 事件。不会合成派生事件，
 * 每个 StatsEvent 必须追溯到通过插件钩子传递的具体 SDK 事件。
 *
 * 覆盖 10 种事件类型：
 *   session.created, session.updated, session.deleted, session.error,
 *   message.updated.user, message.updated.assistant,
 *   tool.execute.pending, tool.execute.running, tool.execute.completed,
 *   tool.execute.failed
 */

// ============================================================================
// 基础类型
// ============================================================================

/** Token 分解结构，被多种事件类型使用 */
export interface TokenBreakdown {
  input: number;
  output: number;
  reasoning: number;
  cache: {
    read: number;
    write: number;
  };
}

// ============================================================================
// 统计事件类型
// ============================================================================

/** 所有统计事件共享的公共字段 */
export interface BaseStatsEvent {
  /** 事件唯一标识 — 用于去重的幂等键 */
  event_id: string;
  /** 事件时间戳（毫秒） */
  created_at_ms: number;
}

/** 会话创建事件 */
export interface SessionCreatedEvent extends BaseStatsEvent {
  event_type: "session.created";
  /** ← event.properties.info.id */
  session_id: string;
  /** ← event.properties.info.directory || input.directory */
  project_path: string;
  /** ← event.properties.info.title ?? "" */
  title: string;
}

/** 会话更新事件（标题变更等） */
export interface SessionUpdatedEvent extends BaseStatsEvent {
  event_type: "session.updated";
  /** ← event.properties.info.id */
  session_id: string;
  /** ← event.properties.info.directory || input.directory */
  project_path: string;
  /** ← event.properties.info.title */
  title: string;
}

/** 会话删除事件 */
export interface SessionDeletedEvent extends BaseStatsEvent {
  event_type: "session.deleted";
  /** ← event.properties.info.id */
  session_id: string;
  /** ← event.properties.info.directory || input.directory */
  project_path: string;
}

/** 会话错误事件 */
export interface SessionErrorEvent extends BaseStatsEvent {
  event_type: "session.error";
  /** ← event.properties.sessionID */
  session_id: string;
  /** ← input.directory */
  project_path: string;
  /** ← event.properties.error.name */
  error_type: string;
  /** ← event.properties.error.data.message */
  error_message: string;
}

/** 消息更新事件 — 用户角色（差异/行统计） */
export interface MessageUpdatedUserEvent extends BaseStatsEvent {
  event_type: "message.updated.user";
  /** ← event.properties.info.id */
  message_id: string;
  /** ← event.properties.info.sessionID */
  session_id: string;
  /** ← input.directory */
  project_path: string;
  /** ← event.properties.info.role */
  role: "user";
  /** ← event.properties.info.agent (user) */
  agent?: string;
  /** ← event.properties.info.summary?.diffs.reduce(sum => sum.additions) */
  lines_added: number;
  /** ← event.properties.info.summary?.diffs.reduce(sum => sum.deletions) */
  lines_deleted: number;
  /** ← event.properties.info.summary?.diffs.length */
  files_changed: number;
  /** ← event.properties.info.time.created */
  created_at_ms: number;
}

/** 消息更新事件 — 助手角色（Token/费用最终确认） */
export interface MessageUpdatedAssistantEvent extends BaseStatsEvent {
  event_type: "message.updated.assistant";
  /** ← event.properties.info.id */
  message_id: string;
  /** ← event.properties.info.sessionID */
  session_id: string;
  /** ← input.directory */
  project_path: string;
  /** ← `${info.providerID}/${info.modelID}` */
  model: string;
  /** ← event.properties.info.mode (assistant) */
  agent?: string;
  /** ← event.properties.info.tokens */
  tokens: TokenBreakdown;
  /** ← event.properties.info.cost ?? 0 */
  cost_usd: number;
  /** ← event.properties.info.time.created */
  created_at_ms: number;
  /** ← event.properties.info.time.completed */
  completed_at_ms?: number;
  /** ← completed_at_ms - created_at_ms */
  duration_ms?: number;
  /** ← event.properties.info.finish */
  finish_reason?: string;
  /** ← event.properties.info.error ? 1 : 0 */
  has_error: number;
  /** ← event.properties.info.error?.name */
  error_type?: string;
}

/** 工具执行待处理事件（来自 tool.execute.before 钩子） */
export interface ToolExecutePendingEvent extends BaseStatsEvent {
  event_type: "tool.execute.pending";
  /** ← input.sessionID */
  session_id: string;
  /** ← ctx.directory */
  project_path: string;
  /** ← input.tool */
  tool_name: string;
  /** ← input.callID */
  call_id: string;
}

/** 工具执行运行中事件（来自 tool.execute.running 钩子） */
export interface ToolExecuteRunningEvent extends BaseStatsEvent {
  event_type: "tool.execute.running";
  /** ← input.sessionID */
  session_id: string;
  /** ← ctx.directory */
  project_path: string;
  /** ← input.tool */
  tool_name: string;
  /** ← input.callID */
  call_id: string;
}

/** 工具执行完成事件（来自 tool.execute.after 钩子） */
export interface ToolExecuteCompletedEvent extends BaseStatsEvent {
  event_type: "tool.execute.completed";
  /** ← input.sessionID */
  session_id: string;
  /** ← ctx.directory */
  project_path: string;
  /** ← input.tool */
  tool_name: string;
  /** ← input.callID */
  call_id: string;
  /** ← output.metadata.duration_ms ?? 0 */
  duration_ms: number;
  /** ← output.title */
  title: string;
}

/** 工具执行失败事件 */
export interface ToolExecuteFailedEvent extends BaseStatsEvent {
  event_type: "tool.execute.failed";
  /** ← input.sessionID */
  session_id: string;
  /** ← ctx.directory */
  project_path: string;
  /** ← input.tool */
  tool_name: string;
  /** ← input.callID */
  call_id: string;
  /** ← output.metadata.duration_ms ?? 0 */
  duration_ms: number;
  /** ← output.metadata.error_message */
  error_message: string;
}

/** 所有统计事件类型的联合类型 */
export type StatsEvent =
  | SessionCreatedEvent
  | SessionUpdatedEvent
  | SessionDeletedEvent
  | SessionErrorEvent
  | MessageUpdatedUserEvent
  | MessageUpdatedAssistantEvent
  | ToolExecutePendingEvent
  | ToolExecuteRunningEvent
  | ToolExecuteCompletedEvent
  | ToolExecuteFailedEvent;

/** 所有事件类型字面量的联合类型（自动派生） */
export type StatsEventType = StatsEvent["event_type"];

// ============================================================================
// 常量
// ============================================================================

/**
 * 隐私敏感字段，绝不能出现在元数据中
 * 测试验证会强制执行此约束
 */
export const FORBIDDEN_METADATA_KEYS = [
  "tool_input",
  "tool_output",
  "message_body",
  "raw_input",
  "raw_output",
] as const;
