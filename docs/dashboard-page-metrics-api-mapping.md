# Dashboard 页面指标与 API 映射

> **时间**: 2026-06-10
> **作者**: Sisyphus + 人工审核者
> **状态**: 实现完成，待后续测试补充

---

## 总体设计

| 项目 | 说明 |
|------|------|
| API 前缀 | `/api/v1/dashboard/*`（共 7 个端点） |
| 旧 API | `/api/v1/stats/*` 已删除，`src/api/stats.ts` 已移除 |
| 时间参数 | `start` / `end`，毫秒时间戳，均为可选；省略时 `start` 默认 0，`end` 默认 `Date.now()` |
| 数据来源 | 实时聚合查询 `events`、`sessions`、`messages`、`tool_calls` 四张表，无中间投影表或缓存层 |
| Schema 变更 | 无。所有端点均在现有 schema 上运行，未新增迁移 |
| 响应格式 | 普通页面 `{ data: ... }`；列表页面 `{ data: [...], meta: { total, limit, offset } }` |
| 字段命名 | 时间字段使用 `*_at_ms` 后缀（毫秒）；文件变更字段使用 `files_changed`；成本字段使用 `cost_usd` |

### 隐私保护

所有端点均不返回以下敏感字段:

- `message_body`（消息正文）
- `tool_input`（工具输入）
- `tool_output`（工具输出）
- `raw_input`（原始输入）
- `raw_output`（原始输出）

Session Detail 的 `messages` 数组仅返回元数据（token、时间戳、role、model 等），不包含消息内容。`errors` 数组中的错误消息来自 `tool_calls.error_message` 或安全提取的事件类型字段，不暴露 `event_contents` 完整 JSON。

### 实现验证证据

类型检查、路由注册、端点冒烟测试等验证结果存放于 `.omo/evidence/` 目录。自动化后端 API 单元测试按项目决策延后至后续迭代补充。

---

## 1. Overview 页面

### 端点

```
GET /api/v1/dashboard/overview?start=&end=
```

### 页面定位

全局总览页：展示使用规模、成本、token、工具、错误、代码变更、近期会话、Top 模型和 Top 工具。

### 响应结构

```ts
{
  data: {
    summary: OverviewSummary
    trend: OverviewTrendPoint[]
    recent_sessions: OverviewRecentSession[]
    top_models: OverviewTopModel[]
    top_tools: OverviewTopTool[]
  }
}
```

### summary 指标

| 指标 | API 字段 | 含义 | 来源表 |
|------|----------|------|--------|
| 总会话数 | `total_sessions` | 时间范围内 session 数 | `sessions` |
| 活跃会话数 | `active_sessions` | status=active 的 session 数 | `sessions` |
| 删除会话数 | `deleted_sessions` | status=deleted 的 session 数 | `sessions` |
| 总消息数 | `total_messages` | user + assistant 消息数 | `messages` |
| 用户消息数 | `total_user_messages` | role=user 消息数 | `messages` |
| 助手消息数 | `total_assistant_messages` | role=assistant 消息数 | `messages` |
| 总 token | `total_tokens` | token 总量 | `messages.total_tokens` |
| 输入 token | `input_tokens` | input token 总量 | `messages.input_tokens` |
| 输出 token | `output_tokens` | output token 总量 | `messages.output_tokens` |
| reasoning token | `reasoning_tokens` | reasoning token 总量 | `messages.reasoning_tokens` |
| cache read | `cache_read` | cache read token 总量 | `messages.cache_read` |
| cache write | `cache_write` | cache write token 总量 | `messages.cache_write` |
| 总成本 | `total_cost_usd` | USD 成本总量 | `messages.cost_usd` |
| 工具调用数 | `total_tool_calls` | tool call 总量 | `tool_calls` |
| 工具错误数 | `total_tool_errors` | status=error 的 tool call 数 | `tool_calls` |
| 总错误数 | `total_errors` | event_type=session.error 的事件数 | `events` |
| 变更文件数 | `files_changed` | 文件变更数 | `messages.files_changed` |
| 新增行数 | `lines_added` | 新增代码行 | `messages.lines_added` |
| 删除行数 | `lines_deleted` | 删除代码行 | `messages.lines_deleted` |
| 项目数 | `total_projects` | distinct project_path | `messages` |
| 模型数 | `total_models` | distinct model（排除 null） | `messages` |
| 活跃天数 | `active_days` | distinct 日期数 | `messages` |
| 每会话 token | `avg_tokens_per_session` | token/session | 聚合计算，session=0 时返回 null |
| 每会话成本 | `avg_cost_per_session` | cost/session | 聚合计算，session=0 时返回 null |
| 每会话消息 | `avg_messages_per_session` | messages/session | 聚合计算，session=0 时返回 null |
| 首次事件时间 | `first_event_at_ms` | 最早活动时间 | `sessions`，无数据时返回 null |
| 末次事件时间 | `last_event_at_ms` | 最晚活动时间 | `sessions`，无数据时返回 null |

### trend

按日聚合的趋势数据点。各来源表按日期分别查询后合并。

| 字段 | 含义 | 来源表 |
|------|------|--------|
| `date` | 日期字符串（YYYY-MM-DD） | `*_at_ms` 转换 |
| `sessions` | 当日 distinct session 数 | `messages` |
| `messages` | 当日消息数 | `messages` |
| `tokens` | 当日 token | `messages.total_tokens` |
| `cost_usd` | 当日成本 | `messages.cost_usd` |
| `tool_calls` | 当日工具调用 | `tool_calls` |
| `errors` | 当日 session.error 事件数 | `events` |

### recent_sessions

最近 10 个会话的轻量卡片数据，不包含消息正文。

| 字段 | 含义 | 来源表 |
|------|------|--------|
| `session_id` | 会话 ID | `sessions` |
| `project_path` | 项目路径 | `sessions` |
| `title` | 标题 | `sessions` |
| `status` | 状态 | `sessions` |
| `total_tokens` | 会话 token | `messages` 聚合 |
| `total_cost_usd` | 会话成本 | `messages` 聚合 |
| `last_event_at_ms` | 最近活动 | `sessions` |

### top_models

按成本降序排列的 Top 5 模型（仅 assistant 消息，排除 null model）。

| 字段 | 含义 | 来源表 |
|------|------|--------|
| `model` | 模型名 | `messages.model` |
| `total_tokens` | token 总量 | `messages` |
| `cost_usd` | 成本 | `messages` |
| `message_count` | assistant message 数 | `messages` |

### top_tools

按调用数降序排列的 Top 5 工具。

| 字段 | 含义 | 来源表 |
|------|------|--------|
| `tool_name` | 工具名 | `tool_calls` |
| `call_count` | 调用数 | `tool_calls` |
| `error_count` | 错误数 | `tool_calls.status='error'` |
| `avg_duration_ms` | 平均耗时（忽略 null duration） | `tool_calls.duration_ms` |

---

## 2. Efficiency 页面

### 端点

```
GET /api/v1/dashboard/efficiency?start=&end=&bucket=day
```

### 页面定位

效率、成本、代码产出和活跃时段分析。

### 响应结构

```ts
{
  data: {
    summary: EfficiencySummary
    timeline: EfficiencyTimelinePoint[]
    heatmap: EfficiencyHeatmapPoint[]
    model_efficiency: EfficiencyModelItem[]
  }
}
```

### summary

| 指标 | API 字段 | 含义 | 来源表 |
|------|----------|------|--------|
| 总会话 | `total_sessions` | session 数 | `sessions` |
| 总消息 | `total_messages` | message 数 | `messages` |
| 总 token | `total_tokens` | token 总量 | `messages` |
| 总成本 | `total_cost_usd` | 成本总量 | `messages` |
| 平均会话时长 | `avg_session_duration_ms` | session duration 平均 | `sessions.duration_ms`，null-safe |
| 每会话 token | `avg_tokens_per_session` | token/session | 聚合计算 |
| 每会话成本 | `avg_cost_per_session` | cost/session | 聚合计算 |
| 每会话消息 | `avg_messages_per_session` | messages/session | 聚合计算 |
| 新增行 | `total_lines_added` | 新增代码行 | `messages.lines_added` |
| 删除行 | `total_lines_deleted` | 删除代码行 | `messages.lines_deleted` |
| 变更文件 | `total_files_changed` | 文件变更 | `messages.files_changed` |
| token/美元 | `tokens_per_usd` | cost efficiency | 聚合计算，cost=0 时返回 null |
| 代码行/美元 | `lines_changed_per_usd` | 产出成本比 | 聚合计算，cost=0 时返回 null |
| 活跃小时消息密度 | `messages_per_active_hour` | 总消息 / 有活动的小时桶数 | `messages.created_at_ms` |

### timeline

按 day 或 hour bucket 聚合的时间线数据。

| 字段 | 含义 | 来源表 |
|------|------|--------|
| `bucket` | day/hour bucket 字符串 | `*_at_ms` |
| `sessions` | bucket 内 distinct session 数 | `messages` |
| `messages` | bucket 内消息数 | `messages` |
| `tokens` | bucket 内 token | `messages` |
| `cost_usd` | bucket 内成本 | `messages` |
| `lines_added` | bucket 内新增行 | `messages` |
| `lines_deleted` | bucket 内删除行 | `messages` |
| `files_changed` | bucket 内变更文件 | `messages` |
| `avg_session_duration_ms` | bucket 内平均会话时长 | `sessions` |

### heatmap

真实活跃热力图，基于 `messages.created_at_ms` 和 `tool_calls.started_at_ms` 的实际 timestamp 聚合。

| 字段 | 含义 | 来源表 |
|------|------|--------|
| `weekday` | 0-6（JS getDay 约定，0=Sunday） | timestamp |
| `hour` | 0-23 | timestamp |
| `messages` | 消息数 | `messages` |
| `tokens` | token | `messages` |
| `cost_usd` | 成本 | `messages` |
| `tool_calls` | 工具调用数 | `tool_calls` |
| `errors` | 错误数 | `events`（session.error） |

### model_efficiency

| 字段 | 含义 | 来源表 |
|------|------|--------|
| `model` | 模型名 | `messages.model` |
| `messages` | assistant message 数 | `messages` |
| `tokens` | token | `messages` |
| `cost_usd` | 成本 | `messages` |
| `avg_tokens_per_message` | token/message | 聚合计算 |
| `cost_per_1k_tokens` | 每 1000 token 成本 | 聚合计算，tokens=0 时返回 null |

---

## 3. Models 页面

### 端点

```
GET /api/v1/dashboard/models?start=&end=&sort=cost_usd&order=desc&limit=50
```

### 页面定位

模型使用量、成本、token 构成、成本效率、错误率和会话关联工具强度分析。

### 响应结构

```ts
{
  data: {
    summary: ModelsSummary
    models: ModelItem[]
    cost_trend: ModelCostTrendPoint[]
  }
}
```

### summary

| 字段 | 含义 | 来源表 |
|------|------|--------|
| `total_models` | 模型数量 | distinct `messages.model` |
| `total_messages` | assistant message 数 | `messages` |
| `total_tokens` | token 总量 | `messages` |
| `total_cost_usd` | 成本总量 | `messages` |
| `top_model_by_tokens` | token 最多模型 | `messages` |
| `top_model_by_cost` | 成本最高模型 | `messages` |
| `cheapest_model_per_1k_tokens` | 单位 token 成本最低模型 | 聚合计算 |

### models

支持按 `cost_usd`、`total_tokens`、`message_count`、`model` 排序，排除 null model。

| 字段 | 含义 | 来源表 |
|------|------|--------|
| `model` | 模型名 | `messages.model` |
| `message_count` | assistant 消息数 | `messages` |
| `session_count` | 使用该模型的 session 数 | `messages.session_id` distinct |
| `input_tokens` | 输入 token | `messages` |
| `output_tokens` | 输出 token | `messages` |
| `reasoning_tokens` | reasoning token | `messages` |
| `cache_read` | cache read | `messages` |
| `cache_write` | cache write | `messages` |
| `total_tokens` | 总 token | `messages` |
| `cost_usd` | 成本 | `messages` |
| `avg_tokens_per_message` | 每消息 token | 聚合计算 |
| `avg_cost_per_message` | 每消息成本 | 聚合计算 |
| `cost_per_1k_tokens` | 每 1000 token 成本 | 聚合计算，tokens=0 时返回 null |
| `associated_tool_call_count` | 关联 session 中的工具调用数 | `tool_calls` 通过 session_id 关联 |
| `error_count` | 错误数 | `messages.has_error` |
| `error_rate` | 错误率 | 聚合计算 |
| `first_used_at_ms` | 首次使用 | `messages.created_at_ms` |
| `last_used_at_ms` | 最近使用 | `messages.created_at_ms` |

### cost_trend

按 `date + model` 聚合。

| 字段 | 含义 | 来源表 |
|------|------|--------|
| `date` | 日期 bucket | `messages.created_at_ms` |
| `model` | 模型名 | `messages.model` |
| `tokens` | token | `messages` |
| `cost_usd` | 成本 | `messages` |
| `messages` | 消息数 | `messages` |

---

## 4. Projects 页面

### 端点

```
GET /api/v1/dashboard/projects?start=&end=&sort=cost_usd&order=desc&limit=50
```

### 页面定位

项目维度的使用规模、成本、产出、活跃度、模型分布和错误/工具强度。

### 响应结构

```ts
{
  data: {
    summary: ProjectsSummary
    projects: ProjectItem[]
    activity_trend: ProjectActivityTrendPoint[]
    project_model_usage: ProjectModelUsageItem[]
  }
}
```

### summary

| 字段 | 含义 | 来源表 |
|------|------|--------|
| `total_projects` | 项目数 | distinct project_path |
| `active_projects` | 范围内有活动的项目数 | `messages` / `sessions` |
| `total_sessions` | session 数 | `sessions` |
| `total_messages` | message 数 | `messages` |
| `total_tokens` | token | `messages` |
| `total_cost_usd` | 成本 | `messages` |
| `total_files_changed` | 文件变更 | `messages` |
| `total_lines_added` | 新增行 | `messages` |
| `total_lines_deleted` | 删除行 | `messages` |
| `top_project_by_tokens` | token 最高项目 | 聚合计算 |
| `top_project_by_cost` | 成本最高项目 | 聚合计算 |
| `top_project_by_activity` | 活动最多项目 | 聚合计算 |

### projects

支持按 `cost_usd`、`total_tokens`、`session_count`、`message_count`、`last_event_at_ms`、`project_path` 排序。

| 字段 | 含义 | 来源表 |
|------|------|--------|
| `project_path` | 完整项目路径 | `sessions` / `messages` |
| `session_count` | session 数 | `sessions` |
| `message_count` | message 数 | `messages` |
| `input_tokens` / `output_tokens` / `reasoning_tokens` / `cache_read` / `cache_write` | token 分解 | `messages` |
| `total_tokens` | token | `messages` |
| `cost_usd` | 成本 | `messages` |
| `files_changed` | 文件变更 | `messages` |
| `lines_added` | 新增行 | `messages` |
| `lines_deleted` | 删除行 | `messages` |
| `tool_call_count` | 工具调用 | `tool_calls` join sessions |
| `tool_error_count` | 工具错误 | `tool_calls.status='error'` |
| `error_count` | 错误数 | `events` / `messages` / `tool_calls` |
| `primary_model` | token 最大模型 | `messages` |
| `model_count` | 模型数 | `messages.model` distinct |
| `avg_tokens_per_session` | token/session | 聚合计算 |
| `avg_cost_per_session` | cost/session | 聚合计算 |
| `avg_messages_per_session` | messages/session | 聚合计算 |
| `first_event_at_ms` | 首次活动 | `sessions` / `messages` |
| `last_event_at_ms` | 最近活动 | `sessions` / `messages` |

### activity_trend

按 `date + project_path` 聚合，非全局趋势。

| 字段 | 含义 | 来源表 |
|------|------|--------|
| `date` | 日期 | timestamp |
| `project_path` | 项目路径 | `messages` |
| `sessions` | session 数 | distinct session |
| `messages` | message 数 | `messages` |
| `tokens` | token | `messages` |
| `cost_usd` | 成本 | `messages` |
| `files_changed` | 文件变更 | `messages` |
| `lines_added` | 新增行 | `messages` |
| `lines_deleted` | 删除行 | `messages` |

### project_model_usage

按 `project_path + model` 聚合的真实模型分布，替代旧实现中全局 model 数据硬分配给 project 的做法。

| 字段 | 含义 | 来源表 |
|------|------|--------|
| `project_path` | 项目路径 | `messages.project_path` |
| `model` | 模型 | `messages.model` |
| `messages` | 消息数 | `messages` |
| `tokens` | token | `messages` |
| `cost_usd` | 成本 | `messages` |

---

## 5. Tools 页面

### 端点

```
GET /api/v1/dashboard/tools?start=&end=&sort=call_count&order=desc&limit=50
```

### 页面定位

工具调用频率、成功率、错误、平均耗时、趋势和近期错误。

### 响应结构

```ts
{
  data: {
    summary: ToolsSummary
    tools: ToolItem[]
    timeline: ToolTimelinePoint[]
    recent_errors: ToolRecentError[]
  }
}
```

### summary

| 字段 | 含义 | 来源表 |
|------|------|--------|
| `total_tool_calls` | 工具调用总数 | `tool_calls` |
| `completed_tool_calls` | completed 数 | `tool_calls.status` |
| `failed_tool_calls` | error 数 | `tool_calls.status` |
| `running_tool_calls` | running 数 | `tool_calls.status` |
| `tool_error_rate` | 错误率 | 聚合计算 |
| `avg_duration_ms` | 平均耗时（忽略 null） | `tool_calls.duration_ms` |
| `total_tools` | 工具种类数 | distinct tool_name |
| `most_used_tool` | 调用最多工具 | 聚合计算 |
| `slowest_tool` | 平均耗时最高工具 | 聚合计算 |
| `most_error_prone_tool` | 错误率最高工具 | 聚合计算 |

### tools

支持按 `call_count`、`error_count`、`avg_duration_ms`、`tool_name` 排序。

| 字段 | 含义 | 来源表 |
|------|------|--------|
| `tool_name` | 工具名 | `tool_calls` |
| `call_count` | 调用数 | `tool_calls` |
| `completed_count` | completed 数 | `tool_calls` |
| `failed_count` | error 数 | `tool_calls` |
| `running_count` | running 数 | `tool_calls` |
| `error_rate` | 错误率 | 聚合计算 |
| `avg_duration_ms` | 平均耗时 | `tool_calls.duration_ms` |
| `min_duration_ms` | 最小耗时 | `tool_calls.duration_ms` |
| `max_duration_ms` | 最大耗时 | `tool_calls.duration_ms` |
| `first_used_at_ms` | 首次调用 | `tool_calls.started_at_ms` |
| `last_used_at_ms` | 最近调用 | `tool_calls.started_at_ms` / `completed_at_ms` |

> 注：不做 p50/p95 分位数统计；前端应使用"按工具平均耗时"而非"耗时分布"。

### timeline

按 `date + tool_name` 聚合。

| 字段 | 含义 | 来源表 |
|------|------|--------|
| `date` | 日期 | `tool_calls.started_at_ms` |
| `tool_name` | 工具名 | `tool_calls` |
| `call_count` | 调用数 | `tool_calls` |
| `failed_count` | 失败数 | `tool_calls.status='error'` |
| `avg_duration_ms` | 平均耗时 | `tool_calls.duration_ms` |

### recent_errors

最近的错误工具调用记录。

| 字段 | 含义 | 来源表 |
|------|------|--------|
| `call_id` | 工具调用 ID | `tool_calls` |
| `session_id` | 会话 ID | `tool_calls` |
| `tool_name` | 工具名 | `tool_calls` |
| `error_message` | 错误消息 | `tool_calls.error_message` |
| `started_at_ms` | 开始时间 | `tool_calls` |
| `completed_at_ms` | 完成时间 | `tool_calls` |
| `duration_ms` | 耗时 | `tool_calls` |

---

## 6. Sessions 页面

### 端点

```
GET /api/v1/dashboard/sessions?start=&end=&status=&project_path=&limit=50&offset=0&sort=last_event_at_ms&order=desc
```

### 页面定位

会话列表、筛选、分页和会话摘要。

### 响应结构

```ts
{
  data: SessionListItem[]
  meta: {
    total: number
    limit: number
    offset: number
  }
}
```

### 查询参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `start` / `end` | ms timestamp | 时间范围 |
| `status` | string | 按 status 筛选（active / deleted） |
| `project_path` | string | 按项目路径筛选 |
| `limit` | number | 分页大小，[1, 100]，默认 20 |
| `offset` | number | 分页偏移，默认 0 |
| `sort` | string | 排序字段，允许：`last_event_at_ms`、`first_event_at_ms`、`duration_ms`、`session_id`、`project_path`、`title` |
| `order` | string | `asc` 或 `desc`，默认 `desc` |

### 列表字段

| 字段 | 含义 | 来源表 |
|------|------|--------|
| `session_id` | 会话 ID | `sessions` |
| `project_path` | 项目路径 | `sessions` |
| `title` | 标题 | `sessions` |
| `status` | active / deleted | `sessions` |
| `message_count` | 消息数 | `messages` |
| `user_message_count` | 用户消息数 | `messages.role` |
| `assistant_message_count` | 助手消息数 | `messages.role` |
| `total_tokens` | token | `messages` |
| `total_cost_usd` | 成本 | `messages` |
| `tool_call_count` | 工具调用 | `tool_calls` |
| `tool_error_count` | 工具错误 | `tool_calls` |
| `error_count` | 错误数 | `events` / `messages` / `tool_calls` |
| `files_changed` | 文件变更 | `messages` |
| `lines_added` | 新增行 | `messages` |
| `lines_deleted` | 删除行 | `messages` |
| `primary_model` | 主要模型（token 最大） | `messages` |
| `model_count` | 模型数（distinct model） | `messages` |
| `first_event_at_ms` | 首次活动 | `sessions` / `messages` |
| `last_event_at_ms` | 最近活动 | `sessions` / `messages` |
| `duration_ms` | 会话时长 | `sessions.duration_ms` |

---

## 7. Session Detail 页面

### 端点

```
GET /api/v1/dashboard/sessions/:id
```

### 页面定位

单个会话的摘要、消息元数据时间线、模型使用、工具调用和错误信息。返回 404 当 session_id 不存在。

### 响应结构

```ts
{
  data: {
    session: SessionDetailSummary
    messages: SessionMessageMetadata[]
    model_usage: SessionModelUsage[]
    tool_calls: SessionToolCall[]
    errors: SessionError[]
  }
}
```

### session

Sessions 列表字段的详细版，增加 token 分解（input/output/reasoning/cache）、cost、代码变更和完整时间聚合。

### messages

仅返回元数据，不返回消息正文。

| 字段 | 含义 | 来源表 |
|------|------|--------|
| `message_id` | 消息 ID | `messages` |
| `event_id` | 事件 ID | `messages` |
| `role` | user / assistant | `messages` |
| `model` | 模型 | `messages` |
| `agent` | agent 名称 | `messages` |
| `input_tokens` / `output_tokens` / `reasoning_tokens` / `cache_read` / `cache_write` / `total_tokens` | token 分解 | `messages` |
| `cost_usd` | 成本 | `messages` |
| `lines_added` / `lines_deleted` / `files_changed` | 代码变更 | `messages` |
| `created_at_ms` / `completed_at_ms` / `duration_ms` | 时间 | `messages` |
| `has_error` / `error_type` | 错误元数据 | `messages` |

### model_usage

按该会话内 model 聚合（从 `messages` 实时聚合，非预存数据）。

| 字段 | 含义 | 来源表 |
|------|------|--------|
| `model` | 模型 | `messages.model` |
| `message_count` | 消息数 | `messages` |
| `input_tokens` / `output_tokens` / `reasoning_tokens` / `cache_read` / `cache_write` / `total_tokens` | token 分解 | `messages` |
| `cost_usd` | 成本 | `messages` |

### tool_calls

| 字段 | 含义 | 来源表 |
|------|------|--------|
| `call_id` | 调用 ID | `tool_calls` |
| `tool_name` | 工具名 | `tool_calls` |
| `status` | running / completed / error | `tool_calls` |
| `title` | 标题 | `tool_calls.title` |
| `error_message` | 错误消息 | `tool_calls.error_message` |
| `started_at_ms` / `completed_at_ms` / `duration_ms` | 时间 | `tool_calls` |

### errors

安全的错误元数据集合。

| 字段 | 含义 | 来源表 |
|------|------|--------|
| `event_id` | 事件 ID | `events` |
| `event_type` | 事件类型 | `events` |
| `created_at_ms` | 事件时间 | `events` |
| `message` | 安全展示的错误消息 | `tool_calls.error_message` 或 event_type 提取 |

---

## 不应实现的指标

| 指标 | 原因 |
|------|------|
| `response_latency_ms` | 现有数据不足以可靠表示用户请求到 AI 回复的真实延迟 |
| `user_count` / per-user 指标 | 无 user_id |
| `quality_score` / `productivity_score` | 无质量/成果验证数据 |
| message body / tool input/output 分析 | 隐私禁止 |
| 全局模型/工具数据推断为项目维度 | 会产生不真实指标 |

---

## SSE 端点（不在本映射范围）

`GET /api/v1/dashboard/stream` 是 Server-Sent Events 端点，用于实时推送轻量级失效通知（事件类型 `notification`）到仪表盘。它不属于上述 Dashboard 查询 API 的范畴，但仪表盘前端可订阅此端点获取实时刷新信号。
