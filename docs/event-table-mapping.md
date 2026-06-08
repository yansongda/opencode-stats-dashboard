# 事件与数据表字段映射

> 每张表的字段来源，"SDK 事件原始字段" 为 SDK 事件的原始路径，"SDK 事件" 为 `@opencode-ai/sdk` 中的 interface，"映射事件" 为 `types/events.ts` 中的 interface

## 时间字段命名规范

| 类型 | 后缀 | 示例 | 说明 |
|------|------|------|------|
| `DATETIME` | `_at` | `created_at`, `updated_at` | SQLite 自动生成的时间戳 |
| `INTEGER` (毫秒时间戳) | `_at_ms` | `created_at_ms`, `started_at_ms` | 从 SDK 事件提取的毫秒时间戳 |

---

## 1. events 表

所有事件都写入此表，`event_contents` 存储完整的 StatsEvent JSON。

### 接收的事件来源

| 钩子 | SDK 事件类型 | SDK 事件 | 转换器 | 写入的 `event_type` |
|------|------------|---------|--------|-------------------|
| `event` | `session.created` | `EventSessionCreated` | `session-created.ts` | `session.created` |
| `event` | `session.updated` | `EventSessionUpdated` | `session-updated.ts` | `session.updated` |
| `event` | `session.deleted` | `EventSessionDeleted` | `session-deleted.ts` | `session.deleted` |
| `event` | `session.error` | `EventSessionError` | `session-error.ts` | `session.error` |
| `event` | `message.updated` | `EventMessageUpdated` | `message-updated.ts` | `message.updated` |
| `event` | `message.part.updated` | `EventMessagePartUpdated` | `tool-failed.ts` | `tool.failed` |
| `tool.execute.before` | 钩子参数 | - | `converter.ts` | `tool.execute.before` |
| `tool.execute.after` | 钩子参数 | - | `converter.ts` | `tool.execute.after` |

### 字段映射

| 字段 | SDK 事件原始字段 | SDK 事件名称 | SDK 事件 | 映射事件 |
|------|----------------|------------|---------|---------|
| `event_id` | `crypto.randomUUID()` 自动生成 | 全部 | - | `BaseStatsEvent` |
| `event_type` | 事件类型字符串 | 全部 | - | `BaseStatsEvent` |
| `session_id` | 见下方各表 | 全部 | - | 各事件 interface |
| `event_contents` | StatsEvent 对象 JSON 序列化 | 全部 | - | - |
| `created_at` | `CURRENT_TIMESTAMP` 自动生成 | 全部 | - | - |
| `created_at_ms` | `Date.now()` 转换时生成 | 全部 | - | `BaseStatsEvent` |

---

## 2. sessions 表

| 字段 | SDK 事件原始字段 | SDK 事件名称 | SDK 事件 | 映射事件 |
|------|----------------|------------|---------|---------|
| `session_id` | `event.properties.info.id` | `session.created` | `EventSessionCreated` | `SessionCreatedEvent` |
| `project_path` | `event.properties.info.directory \|\| input.directory` | `session.created` | `EventSessionCreated` | `SessionCreatedEvent` |
| `title` | `event.properties.info.title ?? ""` | `session.created` | `EventSessionCreated` | `SessionCreatedEvent` |
| `title` | `event.properties.info.title` | `session.updated` | `EventSessionUpdated` | `SessionUpdatedEvent` |
| `status` | 固定值 `'active'` | `session.created` | `EventSessionCreated` | `SessionCreatedEvent` |
| `status` | 固定值 `'deleted'` | `session.deleted` | `EventSessionDeleted` | `SessionDeletedEvent` |
| `deleted_at_ms` | `Date.now()` 转换时生成 | `session.deleted` | `EventSessionDeleted` | `SessionDeletedEvent` |
| `primary_model` | 计算值：`message_count` 最多的模型 | `message.updated` | `EventMessageUpdated` | `MessageUpdatedEvent` |
| `model_usage` | JSON：`{model: {message_count, tokens, cost_usd}}` | `message.updated` | `EventMessageUpdated` | `MessageUpdatedEvent` |
| `first_event_at_ms` | `Date.now()` 转换时生成 | `session.created` | `EventSessionCreated` | `SessionCreatedEvent` |
| `last_event_at_ms` | `Date.now()` 转换时生成 | 全部 | - | - |
| `duration_ms` | 计算值：`last_event_at_ms - first_event_at_ms` | - | - | - |
| `user_message_count` | `event.properties.info.role === "user"` 时 +1 | `message.updated` | `EventMessageUpdated` | `MessageUpdatedEvent` |
| `assistant_message_count` | `event.properties.info.role === "assistant"` 时 +1 | `message.updated` | `EventMessageUpdated` | `MessageUpdatedEvent` |
| `total_tokens` | `info.tokens.input + info.tokens.output + info.tokens.reasoning + info.tokens.cache.read + info.tokens.cache.write` | `message.updated` | `EventMessageUpdated` | `MessageUpdatedEvent` |
| `input_tokens` | `event.properties.info.tokens.input` | `message.updated` | `EventMessageUpdated` | `MessageUpdatedEvent` |
| `output_tokens` | `event.properties.info.tokens.output` | `message.updated` | `EventMessageUpdated` | `MessageUpdatedEvent` |
| `reasoning_tokens` | `event.properties.info.tokens.reasoning` | `message.updated` | `EventMessageUpdated` | `MessageUpdatedEvent` |
| `cache_read` | `event.properties.info.tokens.cache.read` | `message.updated` | `EventMessageUpdated` | `MessageUpdatedEvent` |
| `cache_write` | `event.properties.info.tokens.cache.write` | `message.updated` | `EventMessageUpdated` | `MessageUpdatedEvent` |
| `total_cost_usd` | `event.properties.info.cost ?? 0` | `message.updated` | `EventMessageUpdated` | `MessageUpdatedEvent` |
| `tool_call_count` | +1 | `tool.execute.after` | - | `ToolExecuteAfterEvent` |
| `tool_call_count` | +1 | `tool.failed` | - | `ToolFailedEvent` |
| `tool_error_count` | +1 | `tool.failed` | - | `ToolFailedEvent` |
| `files_changed` | `event.properties.info.summary?.diffs.length` | `message.updated` (role=user) | `EventMessageUpdated` | `MessageUpdatedEvent` |
| `lines_added` | `event.properties.info.summary?.diffs.reduce(sum => sum.additions)` | `message.updated` (role=user) | `EventMessageUpdated` | `MessageUpdatedEvent` |
| `lines_deleted` | `event.properties.info.summary?.diffs.reduce(sum => sum.deletions)` | `message.updated` (role=user) | `EventMessageUpdated` | `MessageUpdatedEvent` |
| `error_count` | +1 | `session.error` | `EventSessionError` | `SessionErrorEvent` |
| `event_count` | +1 | 全部 | - | - |
| `created_at` | `CURRENT_TIMESTAMP` 自动生成 | `session.created` | `EventSessionCreated` | `SessionCreatedEvent` |

---

## 3. models 表

仅处理 `message.updated` 事件，每条事件写入一行明细记录。

| 字段 | SDK 事件原始字段 | SDK 事件名称 | SDK 事件 | 映射事件 |
|------|----------------|------------|---------|---------|
| `event_id` | `crypto.randomUUID()` 自动生成 | `message.updated` | `EventMessageUpdated` | `MessageUpdatedEvent` |
| `session_id` | `event.properties.info.sessionID` | `message.updated` | `EventMessageUpdated` | `MessageUpdatedEvent` |
| `project_path` | `input.directory` | `message.updated` | `EventMessageUpdated` | `MessageUpdatedEvent` |
| `model` | `${event.properties.info.providerID}/${event.properties.info.modelID}` | `message.updated` | `EventMessageUpdated` | `MessageUpdatedEvent` |
| `role` | `event.properties.info.role` | `message.updated` | `EventMessageUpdated` | `MessageUpdatedEvent` |
| `agent` | `event.properties.info.agent` | `message.updated` (role=user) | `EventMessageUpdated` | `MessageUpdatedEvent` |
| `mode` | `event.properties.info.mode` | `message.updated` (role=assistant) | `EventMessageUpdated` | `MessageUpdatedEvent` |
| `input_tokens` | `event.properties.info.tokens.input` | `message.updated` | `EventMessageUpdated` | `MessageUpdatedEvent` |
| `output_tokens` | `event.properties.info.tokens.output` | `message.updated` | `EventMessageUpdated` | `MessageUpdatedEvent` |
| `reasoning_tokens` | `event.properties.info.tokens.reasoning` | `message.updated` | `EventMessageUpdated` | `MessageUpdatedEvent` |
| `cache_read` | `event.properties.info.tokens.cache.read` | `message.updated` | `EventMessageUpdated` | `MessageUpdatedEvent` |
| `cache_write` | `event.properties.info.tokens.cache.write` | `message.updated` | `EventMessageUpdated` | `MessageUpdatedEvent` |
| `total_tokens` | `info.tokens.input + info.tokens.output + info.tokens.reasoning + info.tokens.cache.read + info.tokens.cache.write` | `message.updated` | `EventMessageUpdated` | `MessageUpdatedEvent` |
| `cost_usd` | `event.properties.info.cost ?? 0` | `message.updated` | `EventMessageUpdated` | `MessageUpdatedEvent` |
| `lines_added` | `event.properties.info.summary?.diffs.reduce(sum => sum.additions)` | `message.updated` (role=user) | `EventMessageUpdated` | `MessageUpdatedEvent` |
| `lines_deleted` | `event.properties.info.summary?.diffs.reduce(sum => sum.deletions)` | `message.updated` (role=user) | `EventMessageUpdated` | `MessageUpdatedEvent` |
| `files_changed` | `event.properties.info.summary?.diffs.length` | `message.updated` (role=user) | `EventMessageUpdated` | `MessageUpdatedEvent` |
| `created_at_ms` | `event.properties.info.time.created` | `message.updated` | `EventMessageUpdated` | `MessageUpdatedEvent` |
| `completed_at_ms` | `event.properties.info.time.completed` | `message.updated` (role=assistant) | `EventMessageUpdated` | `MessageUpdatedEvent` |
| `duration_ms` | 计算值：`completed_at_ms - created_at_ms` | `message.updated` (role=assistant) | `EventMessageUpdated` | `MessageUpdatedEvent` |
| `finish_reason` | `event.properties.info.finish` | `message.updated` (role=assistant) | `EventMessageUpdated` | `MessageUpdatedEvent` |
| `has_error` | `event.properties.info.error ? 1 : 0` | `message.updated` (role=assistant) | `EventMessageUpdated` | `MessageUpdatedEvent` |
| `error_type` | `event.properties.info.error?.name` | `message.updated` (role=assistant) | `EventMessageUpdated` | `MessageUpdatedEvent` |
| `created_at` | `CURRENT_TIMESTAMP` 自动生成 | `message.updated` | `EventMessageUpdated` | `MessageUpdatedEvent` |

---

## 4. tool_calls 表

处理 `tool.execute.before`、`tool.execute.after`、`tool.failed` 三种事件。

| 字段 | SDK 事件原始字段 | SDK 事件名称 | SDK 事件 | 映射事件 |
|------|----------------|------------|---------|---------|
| `call_id` | `input.callID` | `tool.execute.before` | 钩子参数 | `ToolExecuteBeforeEvent` |
| `call_id` | `input.callID` | `tool.execute.after` | 钩子参数 | `ToolExecuteAfterEvent` |
| `call_id` | `event.properties.part.callID` | `tool.failed` | `EventMessagePartUpdated` | `ToolFailedEvent` |
| `session_id` | `input.sessionID` | `tool.execute.before` | 钩子参数 | `ToolExecuteBeforeEvent` |
| `session_id` | `input.sessionID` | `tool.execute.after` | 钩子参数 | `ToolExecuteAfterEvent` |
| `session_id` | `event.properties.part.sessionID` | `tool.failed` | `EventMessagePartUpdated` | `ToolFailedEvent` |
| `tool_name` | `input.tool` | `tool.execute.before` | 钩子参数 | `ToolExecuteBeforeEvent` |
| `tool_name` | `input.tool` | `tool.execute.after` | 钩子参数 | `ToolExecuteAfterEvent` |
| `tool_name` | `event.properties.part.tool` | `tool.failed` | `EventMessagePartUpdated` | `ToolFailedEvent` |
| `status` | 固定值 `'running'` | `tool.execute.before` | 钩子参数 | `ToolExecuteBeforeEvent` |
| `status` | 固定值 `'completed'` | `tool.execute.after` | 钩子参数 | `ToolExecuteAfterEvent` |
| `status` | 固定值 `'error'` | `tool.failed` | `EventMessagePartUpdated` | `ToolFailedEvent` |
| `started_at_ms` | `Date.now()` 转换时生成 | `tool.execute.before` | 钩子参数 | `ToolExecuteBeforeEvent` |
| `completed_at_ms` | `Date.now()` 转换时生成 | `tool.execute.after` | 钩子参数 | `ToolExecuteAfterEvent` |
| `completed_at_ms` | `Date.now()` 转换时生成 | `tool.failed` | `EventMessagePartUpdated` | `ToolFailedEvent` |
| `duration_ms` | `output.metadata.duration_ms ?? 0` | `tool.execute.after` | 钩子参数 | `ToolExecuteAfterEvent` |
| `duration_ms` | `event.properties.part.state.time.end - event.properties.part.state.time.start` | `tool.failed` | `EventMessagePartUpdated` | `ToolFailedEvent` |
| `title` | `output.title` | `tool.execute.after` | 钩子参数 | `ToolExecuteAfterEvent` |
| `error_message` | `event.properties.part.state.error` | `tool.failed` | `EventMessagePartUpdated` | `ToolFailedEvent` |
| `created_at` | `CURRENT_TIMESTAMP` 自动生成 | `tool.execute.before` | 钩子参数 | `ToolExecuteBeforeEvent` |
| `updated_at` | `CURRENT_TIMESTAMP` 自动生成 | `tool.execute.after`, `tool.failed` | 钩子参数 | `ToolExecuteAfterEvent`, `ToolFailedEvent` |
