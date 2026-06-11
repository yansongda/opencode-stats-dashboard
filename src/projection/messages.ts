/**
 * 消息投影处理器 — 将消息事件插入消息表
 *
 * 处理的事件：
 *  - message.updated.user：插入行（差异/行统计，无 Token）
 *  - message.updated.assistant：插入行（Token/费用，模型信息）
 *
 * 每个事件对应消息表中的一行（明细表，非聚合）。
 * 使用 INSERT … ON CONFLICT(message_id) DO UPDATE SET 实现安全 upsert：
 *  - 不可变字段（event_id, session_id, project_path, role, agent, model, created_at_ms, created_at）
 *    在冲突时保留原值，不会被覆盖。
 *  - 可变字段（Token、费用、完成状态、代码变更统计等）始终更新为最新值。
 *  - 仅当新事件的 created_at_ms >= 已有记录时才执行更新（防止过期事件覆盖新数据）。
 */

import type {
  MessageUpdatedAssistantEvent,
  MessageUpdatedUserEvent,
  StatsEvent,
  StatsEventType,
} from "@defs/events";
import type { ProjectionHandler, TransactionContext } from "@defs/projections";
import { totalTokens } from "./utils";

const HANDLED_EVENTS: StatsEventType[] = [
  "message.updated.user",
  "message.updated.assistant",
];

// ---------------------------------------------------------------------------
// 事件处理器
// ---------------------------------------------------------------------------

function handleMessageUpdatedUser(
  event: MessageUpdatedUserEvent,
  txn: TransactionContext,
): void {
  txn.run(
    `INSERT INTO messages (
      message_id, event_id, session_id, project_path, model, role, agent,
      input_tokens, output_tokens, reasoning_tokens, cache_read, cache_write, total_tokens,
      cost_usd, lines_added, lines_deleted, files_changed,
      created_at_ms, completed_at_ms, duration_ms,
      finish_reason, has_error, error_type
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(message_id) DO UPDATE SET
      input_tokens = excluded.input_tokens,
      output_tokens = excluded.output_tokens,
      reasoning_tokens = excluded.reasoning_tokens,
      cache_read = excluded.cache_read,
      cache_write = excluded.cache_write,
      total_tokens = excluded.total_tokens,
      cost_usd = excluded.cost_usd,
      lines_added = excluded.lines_added,
      lines_deleted = excluded.lines_deleted,
      files_changed = excluded.files_changed,
      completed_at_ms = excluded.completed_at_ms,
      duration_ms = excluded.duration_ms,
      finish_reason = excluded.finish_reason,
      has_error = excluded.has_error,
      error_type = excluded.error_type
    WHERE excluded.created_at_ms >= messages.created_at_ms`,
    [
      event.message_id,
      event.event_id,
      event.session_id,
      event.project_path,
      null, // 用户消息没有模型
      event.role,
      event.agent ?? null,
      0,
      0,
      0,
      0,
      0,
      0, // 用户消息没有 Token
      0, // 费用
      event.lines_added,
      event.lines_deleted,
      event.files_changed,
      event.created_at_ms,
      null, // 完成时间
      null, // 持续时长
      null, // 完成原因
      0, // 是否有错误
      null, // 错误类型
    ],
  );
}

function handleMessageUpdatedAssistant(
  event: MessageUpdatedAssistantEvent,
  txn: TransactionContext,
): void {
  if (!event.model) return;

  const total = totalTokens(event.tokens);

  txn.run(
    `INSERT INTO messages (
      message_id, event_id, session_id, project_path, model, role, agent,
      input_tokens, output_tokens, reasoning_tokens, cache_read, cache_write, total_tokens,
      cost_usd, lines_added, lines_deleted, files_changed,
      created_at_ms, completed_at_ms, duration_ms,
      finish_reason, has_error, error_type
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(message_id) DO UPDATE SET
      input_tokens = excluded.input_tokens,
      output_tokens = excluded.output_tokens,
      reasoning_tokens = excluded.reasoning_tokens,
      cache_read = excluded.cache_read,
      cache_write = excluded.cache_write,
      total_tokens = excluded.total_tokens,
      cost_usd = excluded.cost_usd,
      lines_added = excluded.lines_added,
      lines_deleted = excluded.lines_deleted,
      files_changed = excluded.files_changed,
      completed_at_ms = excluded.completed_at_ms,
      duration_ms = excluded.duration_ms,
      finish_reason = excluded.finish_reason,
      has_error = excluded.has_error,
      error_type = excluded.error_type
    WHERE excluded.created_at_ms >= messages.created_at_ms`,
    [
      event.message_id,
      event.event_id,
      event.session_id,
      event.project_path,
      event.model,
      "assistant",
      event.agent ?? null,
      event.tokens.input,
      event.tokens.output,
      event.tokens.reasoning,
      event.tokens.cache.read,
      event.tokens.cache.write,
      total,
      event.cost_usd,
      0,
      0,
      0, // 新增行数、删除行数、变更文件数
      event.created_at_ms,
      event.completed_at_ms ?? null,
      event.duration_ms ?? null,
      event.finish_reason ?? null,
      event.has_error,
      event.error_type ?? null,
    ],
  );
}

// ---------------------------------------------------------------------------
// 处理器导出
// ---------------------------------------------------------------------------

export const messagesHandler: ProjectionHandler = {
  handles: HANDLED_EVENTS,

  handle(event: StatsEvent, txn: TransactionContext): void {
    switch (event.event_type) {
      case "message.updated.user":
        handleMessageUpdatedUser(event, txn);
        break;
      case "message.updated.assistant":
        handleMessageUpdatedAssistant(event, txn);
        break;
    }
  },
};
