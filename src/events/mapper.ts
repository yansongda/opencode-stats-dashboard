/**
 * 事件映射层 — 将 OpenCode 事件转为 sidecar 可消费的 IngestEventEnvelope。
 *
 * 公共入口：
 *   buildSdkEnvelope(event)       — event hook 调用，处理 SDK Event
 *   buildToolEnvelope(...)         — tool hooks 调用，构造工具生命周期事件
 *
 * 调用时序（正常会话生命周期）：
 *
 *   1. 用户开始会话
 *      OpenCode 发出 session.created
 *      → event hook → buildSdkEnvelope
 *      → handleEvent → forwarder → sidecar /ingest/event
 *      → SessionReducer 写入 sessions 表
 *
 *   2. AI 回复过程中
 *      OpenCode 发出 message.updated（role=assistant，含 cost/tokens）
 *      → event hook → buildSdkEnvelope
 *      → handleEvent → forwarder → sidecar /ingest/event
 *      → SessionReducer 更新 sessions 表的 tokens/cost
 *
 *   3. 工具调用
 *      OpenCode 调用 tool.execute.before
 *      → buildToolEnvelope(sessionID, tool, callID, "started")
 *      → handleEvent → forwarder → sidecar → ToolReducer 写入 tool_calls 表
 *
 *      OpenCode 调用 tool.execute.after
 *      → buildToolEnvelope(sessionID, tool, callID, "completed", summary)
 *      → handleEvent → forwarder → sidecar → ToolReducer 更新 tool_calls 表
 *
 *   4. 用户删除会话
 *      OpenCode 发出 session.deleted
 *      → event hook → buildSdkEnvelope
 *      → handleEvent → forwarder → sidecar
 *      → SessionReducer 标记 deleted=true
 *
 * 被忽略的事件（返回 null，不进入 sidecar）：
 *   - session.idle         — 心跳，非删除
 *   - message.part.updated — 内容流式输出，无 cost/token
 *   - 非 assistant 的 message.updated — 用户消息无统计意义
 *
 * 隐私边界：
 *   stripSensitiveKeys 在此处剥离 tool_input/tool_output/message_body 等字段，
 *   完整 payload 永远不会到达 sidecar。
 */

import type { Event } from "@opencode-ai/sdk";
import type { IngestEventEnvelope, ToolStatus } from "../types";
import { FORBIDDEN_METADATA_KEYS } from "../types";

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

/**
 * 用 FNV-1a 哈希生成确定性 event_id。
 *
 * 相同 (session_id, timestamp_ms, event_type) 永远产生相同输出，
 * sidecar 依赖此特性做幂等去重。
 */
export function buildEventId(
  session_id: string,
  timestamp_ms: number,
  event_type: string,
): string {
  const input = `${session_id}:${timestamp_ms}:${event_type}`;
  const parts: number[] = [];
  let seed = 0x811c9dc5;

  for (let round = 0; round < 4; round++) {
    let hash = seed;
    for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    parts.push(hash >>> 0);
    seed = hash ^ (round * 0x1b873593);
  }

  const hex = parts.map((p) => p.toString(16).padStart(8, "0")).join("");
  return [
    "evt",
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

/**
 * 剥离隐私敏感字段。
 *
 * FORBIDDEN_METADATA_KEYS（tool_input, tool_output, message_body, raw_input,
 * raw_output）中列出的 key 会被移除，确保完整 payload 不会到达 sidecar。
 */
export function stripSensitiveKeys(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!(FORBIDDEN_METADATA_KEYS as readonly string[]).includes(key)) {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

// ---------------------------------------------------------------------------
// 工具事件构造
// ---------------------------------------------------------------------------

/**
 * 构造工具生命周期事件的 IngestEventEnvelope。
 *
 * tool.execute.before 调用时 status="started"，
 * tool.execute.after 调用时 status="completed"。
 *
 * 调用者：index.ts tool.execute.before / tool.execute.after hooks。
 */
export function buildToolEnvelope(
  sessionID: string,
  tool: string,
  callID: string,
  status: ToolStatus,
  summary?: string | null,
): IngestEventEnvelope {
  const ts = Date.now();
  return {
    event_id: buildEventId(sessionID, ts, `tool.${status}`),
    event_type: `tool.${status}`,
    session_id: sessionID,
    project_path: "",
    timestamp_ms: ts,
    model: "unknown",
    tokens: 0,
    cost_usd: 0,
    tool,
    status,
    summary: summary ?? null,
    deleted: false,
    metadata: stripSensitiveKeys({ call_id: callID }),
  };
}

// ---------------------------------------------------------------------------
// SDK Event → IngestEventEnvelope
// ---------------------------------------------------------------------------

type EnvelopeFields = Pick<
  IngestEventEnvelope,
  "event_type" | "session_id" | "project_path"
> & {
  model?: string;
  tokens?: number;
  cost_usd?: number;
  tool?: string | null;
  status?: ToolStatus | null;
  summary?: string | null;
  deleted?: boolean;
  metadata?: Record<string, unknown>;
};

function makeEnvelope(ts: number, fields: EnvelopeFields): IngestEventEnvelope {
  const session_id = fields.session_id;
  return {
    event_id: buildEventId(session_id, ts, fields.event_type),
    event_type: fields.event_type,
    session_id,
    project_path: fields.project_path,
    timestamp_ms: ts,
    model: fields.model ?? "unknown",
    tokens: fields.tokens ?? 0,
    cost_usd: fields.cost_usd ?? 0,
    tool: fields.tool ?? null,
    status: fields.status ?? null,
    summary: fields.summary ?? null,
    deleted: fields.deleted ?? fields.event_type === "session.deleted",
    metadata: stripSensitiveKeys(fields.metadata ?? {}),
  };
}

/**
 * 将 SDK Event 转为 IngestEventEnvelope。
 *
 * 按 event.type 分派：
 *   session.created      → 提取 sessionID、directory、title、version
 *   session.deleted      → 提取 sessionID、directory、summary 统计
 *   message.updated      → 仅处理 role=assistant，提取 cost/tokens
 *   session.idle         → 返回 null（心跳，非删除）
 *   message.part.updated → 返回 null（内容流，无统计数据）
 *   其他                 → 返回 null
 *
 * 调用者：index.ts event hook。
 */
export function buildSdkEnvelope(event: Event): IngestEventEnvelope | null {
  const now = Date.now();
  const props = event.properties as Record<string, any>;

  switch (event.type) {
    case "session.created": {
      const info = props.info ?? {};
      return makeEnvelope(now, {
        event_type: "session.created",
        session_id: props.sessionID ?? info.id ?? "unknown",
        project_path: info.directory ?? "",
        metadata: { title: info.title, version: info.version },
      });
    }
    case "session.deleted": {
      const info = props.info ?? {};
      const summary = info.summary ?? {};
      return makeEnvelope(now, {
        event_type: "session.deleted",
        session_id: props.sessionID ?? info.id ?? "unknown",
        project_path: info.directory ?? "",
        summary: info.title ?? null,
        deleted: true,
        metadata: {
          additions: summary.additions,
          deletions: summary.deletions,
          files: summary.files,
        },
      });
    }
    case "message.updated": {
      const info = props.info;
      if (!info || info.role !== "assistant") return null;
      return makeEnvelope(now, {
        event_type: "usage.updated",
        session_id: props.sessionID ?? info.sessionID ?? "unknown",
        project_path: "",
        model: `${info.providerID ?? "unknown"}/${info.modelID ?? "unknown"}`,
        tokens: info.tokens?.total ?? 0,
        cost_usd: info.cost ?? 0,
        metadata: {
          message_id: info.id,
          input_tokens: info.tokens?.input,
          output_tokens: info.tokens?.output,
          reasoning_tokens: info.tokens?.reasoning,
          cache_read: info.tokens?.cache?.read,
          cache_write: info.tokens?.cache?.write,
        },
      });
    }
    case "session.idle":
    case "message.part.updated":
      return null;
    default:
      return null;
  }
}
