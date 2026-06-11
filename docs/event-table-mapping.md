# 事件与数据表映射

> 本文档反映当前代码实际状态，基于以下源文件:
> - `src/types/events.ts` (StatsEvent 类型定义)
> - `src/event/converters/*.ts` (SDK 事件到 StatsEvent 的转换)
> - `src/store/event.ts` (EventStore 持久化)
> - `src/projection/sessions.ts` (sessions 投影处理器)
> - `src/projection/messages.ts` (messages 投影处理器)
> - `src/projection/tool-calls.ts` (tool_calls 投影处理器)
> - `src/db/migrations/001_initial.ts` (数据库 schema)

---

## 时间字段命名规范

| 类型 | 后缀 | 示例 | 说明 |
|------|------|------|------|
| `DATETIME` | `_at` | `created_at`, `updated_at` | SQLite 自动生成的时间戳 |
| `INTEGER` (毫秒时间戳) | `_at_ms` | `created_at_ms`, `started_at_ms` | 从 SDK 事件提取的毫秒时间戳 |

---

## SDK 事件到 StatsEvent 映射

共 10 种 StatsEvent 类型。SDK 的 `session.updated`、`session.deleted`、`session.error` 保持原名；`message.updated` 按 role 拆分为两种；`message.part.updated` 按 tool status 拆分为四种。

| SDK 事件类型 | SDK 事件过滤条件 | StatsEvent 类型 | 转换器文件 |
|---|---|---|---|
| `session.created` | - | `session.created` | `session-created.ts` |
| `session.updated` | - | `session.updated` | `session-updated.ts` |
| `session.deleted` | - | `session.deleted` | `session-deleted.ts` |
| `session.error` | - | `session.error` | `session-error.ts` |
| `message.updated` | `role=user` | `message.updated.user` | `message-updated-user.ts` |
| `message.updated` | `role=assistant` | `message.updated.assistant` | `message-updated-assistant.ts` |
| `message.part.updated` | `type=tool, status=pending` | `tool.execute.pending` | `message-part-updated-tool-pending.ts` |
| `message.part.updated` | `type=tool, status=running` | `tool.execute.running` | `message-part-updated-tool-running.ts` |
| `message.part.updated` | `type=tool, status=completed` | `tool.execute.completed` | `message-part-updated-tool-completed.ts` |
| `message.part.updated` | `type=tool, status=error` | `tool.execute.failed` | `message-part-updated-tool-failed.ts` |

---

## 数据库 Schema 概览

当前迁移创建 4 张业务表: `events`, `sessions`, `messages`, `tool_calls`。

### events 表

所有 StatsEvent 统一写入此表，`event_contents` 存储去除了 `event_id`、`event_type`、`created_at_ms` 之后的剩余 JSON；当前实现中 `session_id` 同时存在于独立列和 `event_contents` 内。

| 字段 | 类型 | 说明 |
|---|---|---|
| `event_id` | TEXT PK | 事件唯一 ID (`crypto.randomUUID()`) |
| `event_type` | TEXT NOT NULL | StatsEvent 类型字符串 |
| `session_id` | TEXT NOT NULL | 关联会话 ID |
| `event_contents` | TEXT NOT NULL | StatsEvent JSON (去掉公共字段) |
| `created_at` | DATETIME | 自动生成 `CURRENT_TIMESTAMP` |
| `created_at_ms` | INTEGER NOT NULL | 毫秒时间戳 |

### sessions 表

| 字段 | 类型 | 说明 |
|---|---|---|
| `session_id` | TEXT PK | 会话 ID |
| `project_path` | TEXT | 项目目录 |
| `title` | TEXT | 会话标题 |
| `status` | TEXT DEFAULT 'active' | `active` 或 `deleted` |
| `deleted_at_ms` | INTEGER | 删除时间 (毫秒) |
| `first_event_at_ms` | INTEGER | 首次事件时间 |
| `last_event_at_ms` | INTEGER | 最近事件时间 |
| `duration_ms` | INTEGER | `last_event_at_ms - first_event_at_ms` |
| `created_at` | DATETIME | 自动生成 |

### messages 表

每条消息一行明细记录，使用 `INSERT OR REPLACE` 实现更新。

| 字段 | 类型 | 说明 |
|---|---|---|
| `message_id` | TEXT PK | 消息 ID |
| `event_id` | TEXT NOT NULL | 关联事件 ID |
| `session_id` | TEXT NOT NULL | 关联会话 ID |
| `project_path` | TEXT NOT NULL | 项目目录 |
| `model` | TEXT NOT NULL | 模型标识 (如 `anthropic/claude-sonnet-4-20250514`)；注意当前 user 消息投影写入 `null`，与 schema 约束存在不一致 |
| `role` | TEXT NOT NULL | `user` 或 `assistant` |
| `agent` | TEXT | agent/mode 名称 |
| `input_tokens` | INTEGER DEFAULT 0 | 输入 token 数 |
| `output_tokens` | INTEGER DEFAULT 0 | 输出 token 数 |
| `reasoning_tokens` | INTEGER DEFAULT 0 | 推理 token 数 |
| `cache_read` | INTEGER DEFAULT 0 | 缓存读取 token 数 |
| `cache_write` | INTEGER DEFAULT 0 | 缓存写入 token 数 |
| `total_tokens` | INTEGER DEFAULT 0 | 上述五项之和 |
| `cost_usd` | REAL DEFAULT 0 | 费用 (美元) |
| `lines_added` | INTEGER DEFAULT 0 | 新增行数 |
| `lines_deleted` | INTEGER DEFAULT 0 | 删除行数 |
| `files_changed` | INTEGER DEFAULT 0 | 变更文件数 |
| `created_at_ms` | INTEGER NOT NULL | 消息创建时间 |
| `completed_at_ms` | INTEGER | 消息完成时间 |
| `duration_ms` | INTEGER | `completed_at_ms - created_at_ms` |
| `finish_reason` | TEXT | 完成原因 |
| `has_error` | INTEGER DEFAULT 0 | 是否有错误 (0/1) |
| `error_type` | TEXT | 错误类型名 |
| `created_at` | DATETIME | 自动生成 |

### tool_calls 表

追踪工具调用生命周期，使用 call_id 做幂等 upsert。

| 字段 | 类型 | 说明 |
|---|---|---|
| `call_id` | TEXT PK | 工具调用 ID |
| `session_id` | TEXT NOT NULL | 关联会话 ID |
| `tool_name` | TEXT NOT NULL | 工具名称 |
| `status` | TEXT | `running`、`completed` 或 `error` |
| `started_at_ms` | INTEGER | 开始时间 |
| `completed_at_ms` | INTEGER | 完成时间 |
| `duration_ms` | INTEGER | 持续时间 |
| `title` | TEXT | 工具输出标题 |
| `error_message` | TEXT | 错误信息 |
| `created_at` | DATETIME | 自动生成 |
| `updated_at` | DATETIME | 自动更新 |

---

## 事件写入矩阵

所有事件首先通过 EventStore 写入 events 表 (`INSERT OR IGNORE`)，然后由投影处理器写入各自的聚合/明细表。

| StatsEvent 类型 | events | sessions | messages | tool_calls |
|---|---|---|---|---|
| `session.created` | INSERT OR IGNORE | INSERT OR IGNORE | - | - |
| `session.updated` | INSERT OR IGNORE | UPDATE | - | - |
| `session.deleted` | INSERT OR IGNORE | UPDATE | - | - |
| `session.error` | INSERT OR IGNORE | UPDATE | - | - |
| `message.updated.user` | INSERT OR IGNORE | UPDATE | INSERT OR REPLACE | - |
| `message.updated.assistant` | INSERT OR IGNORE | UPDATE | INSERT OR REPLACE | - |
| `tool.execute.pending` | INSERT OR IGNORE | UPDATE | - | INSERT OR IGNORE |
| `tool.execute.running` | INSERT OR IGNORE | UPDATE | - | (no-op) |
| `tool.execute.completed` | INSERT OR IGNORE | UPDATE | - | upsert |
| `tool.execute.failed` | INSERT OR IGNORE | UPDATE | - | upsert |

---

## 各表写入详情

### sessions 表写入逻辑

**session.created**: `INSERT OR IGNORE` 写入 `session_id`, `project_path`, `title`, `status='active'`, `first_event_at_ms`, `last_event_at_ms`。

**session.updated**: `UPDATE` 写入 `title`, `last_event_at_ms`, `duration_ms = created_at_ms - first_event_at_ms`。

**session.deleted**: `UPDATE` 写入 `status='deleted'`, `deleted_at_ms`, `last_event_at_ms`, `duration_ms`。

**session.error**: `UPDATE` 写入 `last_event_at_ms`, `duration_ms`。

**message.updated.user / message.updated.assistant**: 先调用 `ensureSessionExists` (如果 session 不存在则 INSERT)，然后 `UPDATE` 写入 `last_event_at_ms`, `duration_ms`。

**tool.execute.* (四种)**: 先调用 `ensureSessionExists`，然后 `UPDATE` 写入 `last_event_at_ms`, `duration_ms`。

### messages 表写入逻辑

**message.updated.user**: `INSERT OR REPLACE` 写入一行。`model=null`（用户消息没有模型）, `role='user'`, 所有 token 字段和 `cost_usd` 为 0, `lines_added/lines_deleted/files_changed` 从 event 获取, `created_at_ms` 从 event 获取, `completed_at_ms/duration_ms/finish_reason/has_error/error_type` 为 null/0。

**message.updated.assistant**: 如果 `event.model` 为空则跳过。`INSERT OR REPLACE` 写入一行。`role='assistant'`, token 字段从 `event.tokens` 获取, `total_tokens = input + output + reasoning + cache.read + cache.write`, `cost_usd` 从 event 获取, `lines_added/lines_deleted/files_changed` 为 0, `completed_at_ms/duration_ms/finish_reason/has_error/error_type` 从 event 获取。

### tool_calls 表写入逻辑

**tool.execute.pending**: `INSERT OR IGNORE` 写入 `call_id`, `session_id`, `tool_name`, `status='running'`, `started_at_ms`。

**tool.execute.running**: 在 tool_calls 表中为 no-op (不写入)，但仍写入 events 表并通过 sessions 处理器更新会话时间戳。

**tool.execute.completed**: Upsert 逻辑。如果 call_id 不存在则 `INSERT OR IGNORE` 写入 `status='completed'`；如果已存在则 `UPDATE` 写入 `status`, `completed_at_ms`, `duration_ms`, `title`, `updated_at`。

**tool.execute.failed**: Upsert 逻辑。如果 call_id 不存在则 `INSERT OR IGNORE` 写入 `status='error'`；如果已存在则 `UPDATE` 写入 `status`, `completed_at_ms`, `duration_ms`, `error_message`, `updated_at`。
