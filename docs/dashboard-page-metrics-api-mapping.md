# Dashboard 页面指标与 API 映射

> **时间**: 2026-06-11
> **状态**: 当前实现契约
> **依据**: `packages/shared/src/types/api.ts` 与 `packages/engine/src/api/dashboard/*.ts`

---

## 总体设计

| 项目 | 说明 |
|------|------|
| API 前缀 | `/api/v1/dashboard/*`（7 个 REST 端点 + 1 个 SSE 端点） |
| 数据来源 | 实时查询 `events`、`sessions`、`messages`、`tool_calls` 四张表 |
| 响应包装 | REST 端点统一返回 `{ data: ... }`，当前列表端点不返回 `meta` 分页包装 |
| 时间参数 | `start` / `end` 为毫秒时间戳，可选；由 `parseTimeRange()` 解析默认值 |
| 时区参数 | `tz` 可选，默认 `UTC`；用于日期/小时 bucket 的 fixed-offset SQL 表达式 |
| 字段命名 | 时间字段使用 `*_at_ms` 后缀；成本字段使用 `cost_usd` |

### 隐私保护

Dashboard API 不返回消息正文、工具输入、工具输出或原始 payload。Session Detail 的 `messages` 仅返回元数据；`errors` 返回安全展示字段，不暴露完整 `event_contents`。

---

## 1. Overview 页面

```http
GET /api/v1/dashboard/overview?start=&end=&tz=
```

返回全局总览、每日消息趋势、活跃热力图、Top 模型、模型消息占比和项目成本分布。

```ts
{
  data: {
    summary: DashboardOverviewSummary
    trend: DashboardOverviewTrendPoint[]
    heatmap: DashboardEfficiencyHeatmapPoint[]
    top_models: DashboardOverviewTopModel[]
    model_message_distribution: Array<{
      model: string
      message_count: number
      percentage: number
    }>
    project_distribution: DashboardOverviewProjectDistributionItem[]
  }
}
```

### summary

| 字段 | 来源 |
|------|------|
| `total_sessions`, `active_sessions`, `deleted_sessions` | `sessions` |
| `total_messages`, `total_tokens`, `input_tokens`, `output_tokens`, `total_cost_usd` | `messages` |
| `total_tool_calls`, `total_tool_errors` | `tool_calls` |
| `files_changed`, `lines_added`, `lines_deleted`, `total_projects` | `messages` |
| `avg_project_tokens`, `avg_project_cost`, `avg_project_messages` | 基于项目数的安全除法 |

### 子数据集

| 字段 | 内容 |
|------|------|
| `trend[]` | `{ date, messages, tokens }`，按日聚合 `messages` |
| `heatmap[]` | `{ weekday, hour, messages }`，复用 heatmap 查询组件 |
| `top_models[]` | `{ model, cost_usd }`，assistant 消息按成本 Top 5 |
| `model_message_distribution[]` | assistant 消息按模型统计数量和百分比 |
| `project_distribution[]` | `{ project_path, session_count, cost_usd }` |

---

## 2. Efficiency 页面

```http
GET /api/v1/dashboard/efficiency?start=&end=&bucket=day&tz=
```

`bucket` 支持 `day` / `hour`，其他值按 `day` 处理。

```ts
{
  data: {
    summary: DashboardEfficiencySummary
    timeline: DashboardEfficiencyTimelinePoint[]
    heatmap: DashboardEfficiencyHeatmapPoint[]
  }
}
```

| 区域 | 字段 |
|------|------|
| `summary` | `avg_session_duration_ms`, `avg_cost_per_session`, `total_files_changed`, `messages_per_active_hour` |
| `timeline[]` | `bucket`, `tokens`, `cost_usd`, `lines_added`, `lines_deleted`, `files_changed` |
| `heatmap[]` | `weekday`, `hour`, `messages` |

当前实现不返回 `model_efficiency`、token/美元或代码行/美元等派生指标。

---

## 3. Models 页面

```http
GET /api/v1/dashboard/models?start=&end=&sort=cost_usd&order=desc&limit=50&tz=
```

返回 assistant 消息中非空模型的模型列表和成本趋势；当前实现没有 `summary` 对象。

```ts
{
  data: {
    models: DashboardModelItem[]
    cost_trend: DashboardModelCostTrendPoint[]
  }
}
```

### models[]

| 字段 | 含义 |
|------|------|
| `model` | 模型名 |
| `message_count` | assistant 消息数 |
| `session_count` | 使用该模型的 session 数 |
| `input_tokens`, `output_tokens`, `reasoning_tokens`, `total_tokens` | token 聚合 |
| `cost_usd` | 成本总额 |
| `avg_cost_per_message` | 每消息平均成本 |
| `error_count`, `error_rate` | message error 聚合 |

### cost_trend[]

`{ date, model, cost_usd }`，仅包含当前分页后展示的模型。

---

## 4. Projects 页面

```http
GET /api/v1/dashboard/projects?start=&end=&sort=cost_usd&order=desc&limit=50&offset=0&tz=
```

返回项目列表、项目每日活动趋势和项目-模型使用分布；当前实现没有 `summary` 对象。

```ts
{
  data: {
    projects: DashboardProjectItem[]
    activity_trend: DashboardProjectActivityTrendPoint[]
    project_model_usage: DashboardProjectModelUsageItem[]
  }
}
```

| 区域 | 字段 |
|------|------|
| `projects[]` | `project_path`, `session_count`, `message_count`, `total_tokens`, `cost_usd`, `primary_model`, `last_event_at_ms` |
| `activity_trend[]` | `date`, `project_path`, `messages` |
| `project_model_usage[]` | `project_path`, `model`, `sessions`, `messages` |

空项目路径在响应中归一化为 `(no project)`。

---

## 5. Tools 页面

```http
GET /api/v1/dashboard/tools?start=&end=&sort=call_count&order=desc&limit=20&tz=
```

返回工具调用摘要、按工具聚合、每日调用趋势和近期错误。`limit` 当前用于限制 `recent_errors` 数量，不裁剪 `tools[]`。

```ts
{
  data: {
    summary: DashboardToolsSummary
    tools: DashboardToolItem[]
    timeline: DashboardToolTimelinePoint[]
    recent_errors: DashboardToolRecentError[]
  }
}
```

| 区域 | 字段 |
|------|------|
| `summary` | `total_tool_calls`, `failed_tool_calls`, `tool_error_rate` |
| `tools[]` | `tool_name`, `call_count`, `failed_count`, `error_rate`, `avg_duration_ms`, `min_duration_ms`, `max_duration_ms` |
| `timeline[]` | `date`, `call_count`, `failed_count` |
| `recent_errors[]` | `call_id`, `session_id`, `tool_name`, `error_message`, `started_at_ms`, `completed_at_ms`, `duration_ms` |

当前实现不返回 completed/running 分类计数、首次/末次调用时间或 p50/p95 分位数。

---

## 6. Sessions 页面

```http
GET /api/v1/dashboard/sessions?start=&end=&status=&project_path=&limit=20&offset=0&sort=last_event_at_ms&order=desc&tz=
```

返回分页后的会话列表。当前实现只返回 `{ data: SessionListItem[] }`，不返回总数或 `meta`。

```ts
{
  data: DashboardSessionListItem[]
}
```

| 字段 | 含义 |
|------|------|
| `session_id` | 会话 ID |
| `project_path` | 项目路径，可为 `null` |
| `title` | 标题，可为 `null` |
| `status` | `active` / `deleted` |
| `message_count` | 会话消息数 |
| `total_tokens` | 会话 token 总量 |
| `total_cost_usd` | 会话成本 |
| `primary_model` | token 最大的模型，可为 `null` |
| `last_event_at_ms` | 最近事件时间，可为 `null` |

聚合字段排序（`total_tokens`、`total_cost_usd`、`message_count`）在当前页结果内完成；其他字段由 SQL 排序。

---

## 7. Session Detail 页面

```http
GET /api/v1/dashboard/sessions/:id?tz=
```

返回单个会话详情。`session_id` 缺失返回 400；不存在返回 404。

```ts
{
  data: {
    session: DashboardSessionDetailSummary
    messages: DashboardSessionMessageMetadata[]
    model_usage: DashboardSessionModelUsage[]
    tool_calls: DashboardSessionToolCall[]
    errors: DashboardSessionError[]
  }
}
```

### session

| 字段组 | 字段 |
|--------|------|
| 基本信息 | `session_id`, `project_path`, `title`, `status` |
| 消息统计 | `message_count`, `user_message_count`, `assistant_message_count` |
| token/成本 | `total_tokens`, `input_tokens`, `output_tokens`, `reasoning_tokens`, `cache_read`, `cache_write`, `total_cost_usd` |
| 工具/错误 | `tool_call_count`, `tool_error_count`, `error_count` |
| 代码变更 | `files_changed`, `lines_added`, `lines_deleted` |
| 模型/时间 | `primary_model`, `first_event_at_ms`, `last_event_at_ms`, `duration_ms` |

### 子数据集

| 字段 | 内容 |
|------|------|
| `messages[]` | `message_id`, `role`, `model`, `total_tokens`, `cost_usd`, `files_changed`, `duration_ms`, `has_error`, `error_type` |
| `model_usage[]` | `model`, `message_count`, `input_tokens`, `output_tokens`, `reasoning_tokens`, `total_tokens`, `cost_usd` |
| `tool_calls[]` | `call_id`, `tool_name`, `status`, `title`, `error_message`, `duration_ms` |
| `errors[]` | `event_id`, `event_type`, `created_at_ms`, `message` |

`messages[]` 不返回 `event_id`、agent、token 分解、创建/完成时间或消息正文。

---

## SSE 端点

```http
GET /api/v1/dashboard/stream
```

SSE stream 返回轻量级 `StatsNotification`，用于通知前端刷新。通知包含 `version`、`event_id`、`event_type`、`occurred_at_ms`、`occurred_at` 和可选 `session_id`；不包含 token、成本、工具调用或错误聚合。

---

## 不应从当前数据推断的指标

| 指标 | 原因 |
|------|------|
| `response_latency_ms` | 现有数据不足以可靠表示用户请求到 AI 回复的真实延迟 |
| `user_count` / per-user 指标 | 无 user_id |
| `quality_score` / `productivity_score` | 无质量或成果验证数据 |
| message body / tool input/output 分析 | 隐私禁止 |
| 全局模型/工具数据推断为项目维度 | 会产生不真实指标 |
