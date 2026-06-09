/**
 * 工具调用处理器 — 跟踪单个工具调用的生命周期
 *
 * 处理的事件：
 *  - tool.execute.pending：插入行，记录开始时间（pending/running）
 *  - tool.execute.completed：更新行，设置状态为 completed
 *  - tool.execute.failed：更新行，设置状态为 error
 */

import type {
  StatsEvent,
  StatsEventType,
  ToolExecuteCompletedEvent,
  ToolExecuteFailedEvent,
  ToolExecutePendingEvent,
} from "@defs/events";
import type { ProjectionHandler, TransactionContext } from "@defs/projections";

// ---------------------------------------------------------------------------
// 事件处理器
// ---------------------------------------------------------------------------

interface ToolCallBase {
  call_id: string;
  session_id: string;
  tool_name: string;
  created_at_ms: number;
  duration_ms: number;
}

function upsertToolCall(
  event: ToolCallBase,
  status: "completed" | "error",
  extra: { title?: string; error_message?: string },
  txn: TransactionContext,
): void {
  const existing = txn.get<{ started_at_ms: number }>(
    "SELECT started_at_ms FROM tool_calls WHERE call_id = ?",
    [event.call_id],
  );

  if (!existing) {
    txn.run(
      `INSERT OR IGNORE INTO tool_calls
         (call_id, session_id, tool_name, status, started_at_ms, completed_at_ms, duration_ms, title, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        event.call_id,
        event.session_id,
        event.tool_name,
        status,
        event.created_at_ms,
        event.created_at_ms,
        event.duration_ms || null,
        extra.title ?? null,
        extra.error_message ?? null,
      ],
    );
    return;
  }

  const durationMs =
    event.duration_ms || event.created_at_ms - existing.started_at_ms;

  txn.run(
    `UPDATE tool_calls
     SET status = ?,
         completed_at_ms = ?,
         duration_ms = ?,
         title = COALESCE(?, title),
         error_message = COALESCE(?, error_message),
         updated_at = CURRENT_TIMESTAMP
     WHERE call_id = ?`,
    [
      status,
      event.created_at_ms,
      durationMs,
      extra.title ?? null,
      extra.error_message ?? null,
      event.call_id,
    ],
  );
}

function handleToolExecutePending(
  event: ToolExecutePendingEvent,
  txn: TransactionContext,
): void {
  txn.run(
    `INSERT OR IGNORE INTO tool_calls
       (call_id, session_id, tool_name, status, started_at_ms)
     VALUES (?, ?, ?, 'running', ?)`,
    [event.call_id, event.session_id, event.tool_name, event.created_at_ms],
  );
}

function handleToolExecuteCompleted(
  event: ToolExecuteCompletedEvent,
  txn: TransactionContext,
): void {
  upsertToolCall(event, "completed", { title: event.title }, txn);
}

function handleToolExecuteFailed(
  event: ToolExecuteFailedEvent,
  txn: TransactionContext,
): void {
  upsertToolCall(event, "error", { error_message: event.error_message }, txn);
}

// ---------------------------------------------------------------------------
// 处理器导出
// ---------------------------------------------------------------------------

const HANDLED_EVENTS: StatsEventType[] = [
  "tool.execute.pending",
  "tool.execute.running",
  "tool.execute.completed",
  "tool.execute.failed",
];

export const toolCallHandler: ProjectionHandler = {
  handles: HANDLED_EVENTS,

  handle(event: StatsEvent, txn: TransactionContext): void {
    switch (event.event_type) {
      case "tool.execute.pending":
        handleToolExecutePending(event, txn);
        break;
      case "tool.execute.running":
        // 可选：暂不处理 running 状态
        break;
      case "tool.execute.completed":
        handleToolExecuteCompleted(event, txn);
        break;
      case "tool.execute.failed":
        handleToolExecuteFailed(event, txn);
        break;
    }
  },
};
