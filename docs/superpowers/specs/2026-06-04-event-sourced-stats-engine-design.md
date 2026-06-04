# OpenCode Stats Engine - Event Sourced Architecture Design

**日期**: 2026-06-04  
**状态**: 设计完成，待审核  
**作者**: Sisyphus  

---

## 1. 概述

### 1.1 背景

OpenCode Stats Dashboard 需要从基础的用量监控升级为全面的个人效率分析平台。

### 1.2 设计目标

| 维度 | 要求 |
|------|------|
| 使用场景 | 个人效率分析 |
| 分析维度 | 时间效率、成本效率、产出效率（全面洞察） |
| 时间粒度 | 实时监控 + 历史趋势 |
| 对比维度 | 时间对比、模型对比、项目对比 |
| 衡量方式 | 平衡视角（关键指标精确，辅助指标看趋势） |
| 存储策略 | 适度精简（保留关键统计，聚合历史数据） |

### 1.3 核心指标

**时间效率**：
- 会话时长、响应等待时间、工具执行时间、工作时段分布

**成本效率**：
- 每任务成本、每行代码成本、模型性价比、token 利用率

**产出效率**：
- 代码变更量、任务完成率、错误重试率、消息轮次效率

---

## 2. 架构设计

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          OpenCode Stats Engine                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   ┌──────────────┐      ┌──────────────┐      ┌──────────────┐        │
│   │  Event Store │      │  Projection  │      │    Query     │        │
│   │  (事件存储)   │ ──── │   Engine     │ ──── │   Engine     │        │
│   │              │      │  (投影引擎)   │      │  (查询引擎)   │        │
│   └──────────────┘      └──────────────┘      └──────────────┘        │
│          │                     │                      │                │
│          ▼                     ▼                      ▼                │
│   ┌──────────────┐      ┌──────────────┐      ┌──────────────┐        │
│   │  Raw Events  │      │  Materialized│      │   API Layer  │        │
│   │  (原始事件)   │      │  Views       │      │  (REST API)  │        │
│   │              │      │  (物化视图)   │      │              │        │
│   └──────────────┘      └──────────────┘      └──────────────┘        │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 核心概念

| 概念 | 说明 | 存储位置 |
|------|------|----------|
| **Event** | 不可变的事实记录，按时间序列存储 | `events` 表（只追加） |
| **Projection** | 从事件派生的聚合视图，可重建 | `projections` 表（可重建） |
| **Snapshot** | 定期保存的投影快照，用于快速恢复 | `snapshots` 表 |
| **Query** | 读取模型，支持实时 + 历史查询 | 内存/缓存 |

### 2.3 数据流

```
OpenCode Event
      │
      ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Ingestion  │ ──▶ │ Event Store │ ──▶ │ Projection  │
│  Pipeline   │     │  (持久化)    │     │   Engine    │
└─────────────┘     └─────────────┘     └─────────────┘
                           │                    │
                           ▼                    ▼
                    ┌─────────────┐     ┌─────────────┐
                    │  Snapshot   │     │ Materialized│
                    │  (事件驱动)  │     │    Views    │
                    └─────────────┘     └─────────────┘
                                              │
                                              ▼
                                       ┌─────────────┐
                                       │  Dashboard  │
                                       │   (前端)     │
                                       └─────────────┘
```

---

## 3. Event Store（事件存储层）

### 3.1 events 表结构

```sql
CREATE TABLE events (
    -- 事件标识
    event_id        TEXT PRIMARY KEY,           -- 幂等键（FNV-1a 哈希）
    event_type      TEXT NOT NULL,              -- 事件类型（30种）
    
    -- 关联标识
    session_id      TEXT NOT NULL,              -- 会话 ID
    
    -- 时间信息
    timestamp_ms    INTEGER NOT NULL,           -- 事件时间戳
    ingested_at     DATETIME DEFAULT CURRENT_TIMESTAMP,  -- 入库时间
    
    -- 核心统计（快速查询用）
    model           TEXT,                       -- 模型标识
    total_tokens    INTEGER DEFAULT 0,          -- token 总数
    cost_usd        REAL DEFAULT 0,             -- 成本（美元）
    
    -- 事件详细内容（JSON）
    event_contents  TEXT NOT NULL DEFAULT '{}', -- 事件特定数据
    
    -- 索引
    INDEX idx_session (session_id),
    INDEX idx_type (event_type),
    INDEX idx_timestamp (timestamp_ms),
    INDEX idx_model (model)
);
```

### 3.2 设计原则

| 原则 | 说明 |
|------|------|
| **不可变性** | 事件一旦写入，永不修改或删除 |
| **幂等性** | 相同 event_id 只写入一次 |
| **完整性** | 保留所有原始信息，不丢失 |
| **可追溯** | 每个事件都有完整的时间和关联信息 |

### 3.3 event_contents 结构示例

> **SDK 参考文档**
> 
> - **官方文档**: https://opencode.ai/docs/sdk
> - **GitHub 仓库**: https://github.com/anomalyco/opencode
> - **NPM 包**: https://www.npmjs.com/package/@opencode-ai/sdk
> - **类型定义源码**: [`packages/sdk/js/src/gen/types.gen.ts`](https://github.com/anomalyco/opencode/blob/8a17bc4de038a57807b434cf8aa31eac50d245a9/packages/sdk/js/src/gen/types.gen.ts)

#### session.created

> SDK 类型: `EventSessionCreated` ([L493-L498](https://github.com/anomalyco/opencode/blob/8a17bc4de038a57807b434cf8aa31eac50d245a9/packages/sdk/js/src/gen/types.gen.ts#L493-L498))
> 
> 关联类型: `Session` ([L465-L492](https://github.com/anomalyco/opencode/blob/8a17bc4de038a57807b434cf8aa31eac50d245a9/packages/sdk/js/src/gen/types.gen.ts#L465-L492))

```json
{
  "project_path": "/Users/user/project",
  "title": "实现用户认证",
  "version": "1.0.0"
}
```

#### message.updated (assistant)

> SDK 类型: `EventMessageUpdated` ([L129-L134](https://github.com/anomalyco/opencode/blob/8a17bc4de038a57807b434cf8aa31eac50d245a9/packages/sdk/js/src/gen/types.gen.ts#L129-L134))
> 
> 关联类型: `AssistantMessage` ([L98-L127](https://github.com/anomalyco/opencode/blob/8a17bc4de038a57807b434cf8aa31eac50d245a9/packages/sdk/js/src/gen/types.gen.ts#L98-L127))

```json
{
  "message_id": "msg_abc123",
  "role": "assistant",
  "tokens": {
    "input": 1000,
    "output": 500,
    "reasoning": 200,
    "cache": {
      "read": 300,
      "write": 100
    }
  }
}
```

#### tool.execute.after (插件钩子)

> SDK 类型: 插件钩子 `tool.execute.after`
> 
> 参考: [`packages/plugin/src/index.ts`](https://github.com/anomalyco/opencode/blob/8a17bc4de038a57807b434cf8aa31eac50d245a9/packages/plugin/src/index.ts)
> 
> 关联类型: `ToolStateCompleted` ([L231-L247](https://github.com/anomalyco/opencode/blob/8a17bc4de038a57807b434cf8aa31eac50d245a9/packages/sdk/js/src/gen/types.gen.ts#L231-L247))

```json
{
  "tool_name": "read_file",
  "call_id": "call_xyz789",
  "status": "completed",
  "title": "读取配置文件",
  "duration_ms": 150
}
```

#### file.edited

> SDK 类型: `EventFileEdited` ([L425-L430](https://github.com/anomalyco/opencode/blob/8a17bc4de038a57807b434cf8aa31eac50d245a9/packages/sdk/js/src/gen/types.gen.ts#L425-L430))

```json
{
  "file_path": "src/auth.ts",
  "additions": 25,
  "deletions": 10
}
```

#### permission.updated

> SDK 类型: `EventPermissionUpdated` ([L384-L387](https://github.com/anomalyco/opencode/blob/8a17bc4de038a57807b434cf8aa31eac50d245a9/packages/sdk/js/src/gen/types.gen.ts#L384-L387))
> 
> 关联类型: `Permission` ([L369-L383](https://github.com/anomalyco/opencode/blob/8a17bc4de038a57807b434cf8aa31eac50d245a9/packages/sdk/js/src/gen/types.gen.ts#L369-L383))

```json
{
  "permission_id": "perm_abc",
  "permission_type": "bash",
  "pattern": "npm install",
  "response": "allow"
}
```

---

## 4. Projections（投影层）

### 4.1 projection_sessions

```sql
CREATE TABLE projection_sessions (
    -- 主键
    session_id      TEXT PRIMARY KEY,
    
    -- 基本信息
    project_path    TEXT,
    title           TEXT,
    
    -- 状态
    status          TEXT DEFAULT 'active',  -- active/deleted
    deleted_at      INTEGER,
    
    -- 模型信息
    primary_model   TEXT,           -- 使用最多的 model
    model_usage     TEXT,           -- JSON（见下方结构）
    
    -- 时间维度
    first_event_at  INTEGER,
    last_event_at   INTEGER,
    duration_ms     INTEGER,
    
    -- 消息统计
    user_message_count      INTEGER DEFAULT 0,
    assistant_message_count INTEGER DEFAULT 0,
    
    -- Token 统计（会话级汇总）
    total_tokens    INTEGER DEFAULT 0,
    input_tokens    INTEGER DEFAULT 0,
    output_tokens   INTEGER DEFAULT 0,
    reasoning_tokens INTEGER DEFAULT 0,
    cache_read      INTEGER DEFAULT 0,
    cache_write     INTEGER DEFAULT 0,
    
    -- 成本统计
    total_cost_usd  REAL DEFAULT 0,
    
    -- 工具统计
    tool_call_count INTEGER DEFAULT 0,
    tool_error_count INTEGER DEFAULT 0,
    
    -- 文件统计
    files_edited    INTEGER DEFAULT 0,
    lines_added     INTEGER DEFAULT 0,
    lines_deleted   INTEGER DEFAULT 0,
    
    -- Agent 统计
    primary_agent   TEXT,           -- 主要使用的 agent
    agent_usage     TEXT,           -- JSON（见下方结构）
    
    -- 错误统计
    error_count     INTEGER DEFAULT 0,
    
    -- 投影元数据
    projected_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    event_count     INTEGER DEFAULT 0
);
```

#### model_usage JSON 结构

```json
{
  "claude-sonnet": {
    "message_count": 5,
    "tokens": {
      "total": 1800,
      "input": 1000,
      "output": 500,
      "reasoning": 200,
      "cache": {
        "read": 100,
        "write": 50
      }
    },
    "cost_usd": 0.018
  },
  "gpt-4o": {
    "message_count": 2,
    "tokens": {
      "total": 500,
      "input": 300,
      "output": 200,
      "reasoning": 0,
      "cache": {
        "read": 0,
        "write": 0
      }
    },
    "cost_usd": 0.005
  }
}
```

#### agent_usage JSON 结构

```json
{
  "build": {
    "message_count": 8,
    "tokens": {
      "total": 2000,
      "input": 1200,
      "output": 800,
      "reasoning": 300,
      "cache": {
        "read": 200,
        "write": 100
      }
    },
    "cost_usd": 0.020
  },
  "plan": {
    "message_count": 3,
    "tokens": {
      "total": 500,
      "input": 300,
      "output": 200,
      "reasoning": 50,
      "cache": {
        "read": 50,
        "write": 20
      }
    },
    "cost_usd": 0.005
  }
}
```

#### 字段来源映射

| 字段 | 来源事件 | 更新时机 |
|------|---------|---------|
| `session_id` | `session.created` | 创建时 |
| `project_path` | `session.created.info.directory` | 创建时 |
| `title` | `session.created.info.title` | 创建时 |
| `status` | `session.deleted` | 删除时更新为 `deleted` |
| `primary_model` | 从 `model_usage` 计算 | 每次更新 model_usage 后 |
| `model_usage` | `message.updated` (assistant) | 每次 AI 回复时 |
| `first_event_at` | `session.created.time.created` | 创建时 |
| `last_event_at` | 各事件 `timestamp_ms` | 每次事件时 |
| `duration_ms` | `last_event_at - first_event_at` | 每次更新 last_event_at 后 |
| `user_message_count` | `message.updated` (role=user) | 每次用户消息时 |
| `assistant_message_count` | `message.updated` (role=assistant) | 每次 AI 回复时 |
| `total_tokens` | `message.updated.tokens.total` | 每次消息时累加 |
| `input_tokens` | `message.updated.tokens.input` | 每次消息时累加 |
| `output_tokens` | `message.updated.tokens.output` | 每次消息时累加 |
| `reasoning_tokens` | `message.updated.tokens.reasoning` | 每次消息时累加 |
| `cache_read` | `message.updated.tokens.cache.read` | 每次消息时累加 |
| `cache_write` | `message.updated.tokens.cache.write` | 每次消息时累加 |
| `total_cost_usd` | `message.updated.cost` | 每次消息时累加 |
| `tool_call_count` | `tool.execute.before` | 每次工具调用时 |
| `tool_error_count` | `tool.execute.after` (status=error) | 工具错误时 |
| `files_edited` | `file.edited` | 每次文件编辑时 |
| `lines_added` | `session.diff` 或 `session.deleted.info.summary` | 会话结束时 |
| `lines_deleted` | `session.diff` 或 `session.deleted.info.summary` | 会话结束时 |
| `primary_agent` | 从 `agent_usage` 计算 | 每次更新 agent_usage 后 |
| `agent_usage` | `AgentPart` 事件 | 每次 agent 切换时 |
| `error_count` | `session.error` | 每次错误时 |

### 4.2 projection_daily

```sql
CREATE TABLE projection_daily (
    -- 复合主键
    date            TEXT NOT NULL,      -- YYYY-MM-DD
    project_path    TEXT NOT NULL,
    model           TEXT NOT NULL,
    
    -- 会话统计
    session_count   INTEGER DEFAULT 0,
    active_sessions INTEGER DEFAULT 0,
    deleted_sessions INTEGER DEFAULT 0,
    
    -- 消息统计
    message_count   INTEGER DEFAULT 0,
    user_messages   INTEGER DEFAULT 0,
    assistant_messages INTEGER DEFAULT 0,
    
    -- Token 统计
    total_tokens    INTEGER DEFAULT 0,
    input_tokens    INTEGER DEFAULT 0,
    output_tokens   INTEGER DEFAULT 0,
    reasoning_tokens INTEGER DEFAULT 0,
    cache_read      INTEGER DEFAULT 0,
    cache_write     INTEGER DEFAULT 0,
    
    -- 成本统计
    total_cost_usd  REAL DEFAULT 0,
    
    -- 工具统计
    tool_calls      INTEGER DEFAULT 0,
    tool_errors     INTEGER DEFAULT 0,
    
    -- 文件统计
    files_edited    INTEGER DEFAULT 0,
    lines_added     INTEGER DEFAULT 0,
    lines_deleted   INTEGER DEFAULT 0,
    
    -- Agent 统计
    agent_usage     TEXT,               -- JSON
    
    -- 错误统计
    error_count     INTEGER DEFAULT 0,
    
    -- 投影元数据
    projected_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    event_count     INTEGER DEFAULT 0,
    
    PRIMARY KEY (date, project_path, model)
);
```

#### 查询示例

**查询某天总计**：
```sql
SELECT 
    date,
    SUM(session_count) as total_sessions,
    SUM(message_count) as total_messages,
    SUM(total_tokens) as total_tokens,
    SUM(total_cost_usd) as total_cost
FROM projection_daily
WHERE date = '2026-06-04'
GROUP BY date
```

**查询模型对比**：
```sql
SELECT 
    model,
    SUM(total_tokens) as tokens,
    SUM(total_cost_usd) as cost,
    SUM(message_count) as messages
FROM projection_daily
WHERE date BETWEEN '2026-06-01' AND '2026-06-30'
GROUP BY model
ORDER BY cost DESC
```

**查询项目对比**：
```sql
SELECT 
    project_path,
    SUM(session_count) as sessions,
    SUM(total_tokens) as tokens,
    SUM(total_cost_usd) as cost
FROM projection_daily
WHERE date BETWEEN '2026-06-01' AND '2026-06-30'
GROUP BY project_path
ORDER BY cost DESC
```

### 4.3 projection_tool_calls

```sql
CREATE TABLE projection_tool_calls (
    -- 主键
    call_id         TEXT PRIMARY KEY,
    session_id      TEXT NOT NULL,
    
    -- 工具信息
    tool_name       TEXT NOT NULL,
    
    -- 状态
    status          TEXT,               -- pending/running/completed/error
    
    -- 时间
    started_at      INTEGER,
    completed_at    INTEGER,
    duration_ms     INTEGER,
    
    -- Token 统计
    input_tokens    INTEGER DEFAULT 0,
    output_tokens   INTEGER DEFAULT 0,
    cache_read      INTEGER DEFAULT 0,
    cache_write     INTEGER DEFAULT 0,
    
    -- 成本统计
    cost_usd        REAL DEFAULT 0,
    
    -- 结果
    title           TEXT,
    error_message   TEXT,
    
    -- 投影元数据
    projected_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_session (session_id),
    INDEX idx_tool (tool_name),
    INDEX idx_status (status)
);
```

### 4.4 投影引擎工作流程

```
事件流
  │
  ▼
┌─────────────────────────────────────────────────────┐
│                 Projection Engine                    │
├─────────────────────────────────────────────────────┤
│                                                     │
│  1. 接收新事件                                       │
│     │                                               │
│     ▼                                               │
│  2. 解析 event_type                                 │
│     │                                               │
│     ├─▶ session.* ──▶ 更新 projection_sessions      │
│     │                                               │
│     ├─▶ message.* ──▶ 更新 projection_sessions      │
│     │                 更新 projection_daily         │
│     │                                               │
│     ├─▶ tool.*    ──▶ 更新 projection_tool_calls    │
│     │                 更新 projection_sessions      │
│     │                 更新 projection_daily         │
│     │                                               │
│     └─▶ file.*    ──▶ 更新 projection_sessions      │
│                       更新 projection_daily         │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### 4.5 投影重建机制

```typescript
// 从事件重建投影
async function rebuildProjection(
  eventType: string,
  startTime?: number  // 可选：从某个时间点开始重建
): Promise<void> {
  // 1. 清空目标投影表（或从 startTime 之后的数据）
  // 2. 查询事件
  const events = await db.query(`
    SELECT * FROM events 
    WHERE event_type LIKE '${eventType}%'
    ${startTime ? `AND timestamp_ms > ${startTime}` : ''}
    ORDER BY timestamp_ms ASC
  `);
  
  // 3. 逐条处理事件，更新投影
  for (const event of events) {
    await processEventForProjection(event);
  }
}
```

---

## 5. Snapshots（快照层）

### 5.1 snapshots 表结构

```sql
CREATE TABLE snapshots (
    -- 主键
    snapshot_id     TEXT PRIMARY KEY,       -- 格式: {type}_{target}_{timestamp}
    
    -- 快照类型
    snapshot_type   TEXT NOT NULL,          -- session/daily/weekly/monthly
    
    -- 目标标识
    target_id       TEXT NOT NULL,          -- session_id 或 date 范围
    
    -- 时间信息
    snapshot_at     INTEGER NOT NULL,       -- 快照时间戳
    period_start    INTEGER,                -- 周期开始时间
    period_end      INTEGER,                -- 周期结束时间
    
    -- 快照内容
    snapshot_data   TEXT NOT NULL,          -- JSON 快照数据
    
    -- 元数据
    event_count     INTEGER,                -- 快照包含的事件数
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_type (snapshot_type),
    INDEX idx_target (target_id),
    INDEX idx_time (snapshot_at)
);
```

### 5.2 快照 ID 格式

| 类型 | 格式 | 示例 |
|------|------|------|
| session | `session_{session_id}_{timestamp}` | `session_ses_abc123_1717400000` |
| daily | `daily_{date}_{timestamp}` | `daily_2026-06-04_1717486400` |
| weekly | `weekly_{year}-W{week}_{timestamp}` | `weekly_2026-W23_1718006400` |
| monthly | `monthly_{year}-{month}_{timestamp}` | `monthly_2026-06_1717200000` |

### 5.3 触发策略

**事件驱动 + 查询时补全**

| 类型 | 触发时机 | 说明 |
|------|---------|------|
| `session` | 收到 `session.deleted` 事件时 | 会话结束立即生成 |
| `daily` | 收到跨天事件时，触发前一天快照 | 事件驱动 |
| `weekly` | 收到跨周事件时，触发上一周快照 | 事件驱动 |
| `monthly` | 收到跨月事件时，触发上一月快照 | 事件驱动 |

### 5.4 实现逻辑

```typescript
// 处理每个事件时检查是否需要生成快照
async function processEvent(event: Event): Promise<void> {
  const eventDate = new Date(event.timestamp_ms);
  const lastEventDate = getLastEventDate();
  
  // 1. 检查是否跨天
  if (lastEventDate && isNewDay(eventDate, lastEventDate)) {
    await generateDailySnapshot(formatDate(lastEventDate));
  }
  
  // 2. 检查是否跨周
  if (lastEventDate && isNewWeek(eventDate, lastEventDate)) {
    await generateWeeklySnapshot(getWeek(lastEventDate));
  }
  
  // 3. 检查是否跨月
  if (lastEventDate && isNewMonth(eventDate, lastEventDate)) {
    await generateMonthlySnapshot(getMonth(lastEventDate));
  }
  
  // 4. 处理事件本身
  await processEventForProjection(event);
  
  // 5. 更新最后事件时间
  updateLastEventDate(eventDate);
}

// 会话结束时生成快照
async function handleSessionDeleted(event: Event): Promise<void> {
  const sessionId = event.properties.info.id;
  await generateSessionSnapshot(sessionId);
}
```

### 5.5 查询时补全

```typescript
async function getDailyStats(date: string): Promise<DailyStats> {
  // 1. 尝试从快照获取
  let snapshot = await getSnapshot('daily', date);
  
  // 2. 如果没有快照，动态生成
  if (!snapshot) {
    snapshot = await generateDailySnapshot(date);
  }
  
  return snapshot.data;
}

async function getMonthlyStats(yearMonth: string): Promise<MonthlyStats> {
  // 1. 尝试从快照获取
  let snapshot = await getSnapshot('monthly', yearMonth);
  
  // 2. 如果没有快照，聚合该月所有 daily 快照
  if (!snapshot) {
    const days = getDaysInMonth(yearMonth);
    const dailySnapshots = await Promise.all(
      days.map(d => getDailyStats(d))
    );
    snapshot = aggregateDailyToMonthly(dailySnapshots);
    await saveSnapshot('monthly', yearMonth, snapshot);
  }
  
  return snapshot.data;
}
```

### 5.6 快照有效性检查

```typescript
interface SnapshotMetadata {
  last_event_at: number;    // 快照包含的最后事件时间
  event_count: number;      // 快照包含的事件数
}

async function isSnapshotValid(
  snapshotType: string,
  targetId: string
): Promise<boolean> {
  const snapshot = await getSnapshot(snapshotType, targetId);
  if (!snapshot) return false;
  
  // 检查是否有新事件
  const newEventCount = await countEvents({
    after: snapshot.metadata.last_event_at,
    // 根据 snapshotType 添加过滤条件
  });
  
  return newEventCount === 0;
}
```

### 5.7 快照内容示例

**session 快照**：
```json
{
  "session_id": "ses_abc123",
  "project_path": "~/project-a",
  "title": "实现用户认证",
  "status": "deleted",
  "deleted_at": 1717400100,
  
  "primary_model": "claude-sonnet",
  "model_usage": {
    "claude-sonnet": {
      "message_count": 5,
      "tokens": {
        "total": 1800,
        "input": 1000,
        "output": 500,
        "reasoning": 200,
        "cache": { "read": 100, "write": 50 }
      },
      "cost_usd": 0.018
    }
  },
  
  "duration_ms": 1800000,
  "user_message_count": 3,
  "assistant_message_count": 5,
  
  "total_tokens": 1800,
  "input_tokens": 1000,
  "output_tokens": 500,
  "reasoning_tokens": 200,
  "cache_read": 100,
  "cache_write": 50,
  "total_cost_usd": 0.018,
  
  "tool_call_count": 15,
  "tool_error_count": 1,
  "files_edited": 3,
  "lines_added": 150,
  "lines_deleted": 30,
  
  "primary_agent": "build",
  "agent_usage": {
    "build": { "message_count": 4, "tokens": { "total": 1500 }, "cost_usd": 0.015 },
    "plan": { "message_count": 1, "tokens": { "total": 300 }, "cost_usd": 0.003 }
  },
  
  "error_count": 0
}
```

**daily 快照**：
```json
{
  "date": "2026-06-04",
  "period_start": 1717401600,
  "period_end": 1717488000,
  
  "sessions": {
    "total": 5,
    "active": 4,
    "deleted": 1
  },
  
  "messages": {
    "total": 25,
    "user": 10,
    "assistant": 15
  },
  
  "tokens": {
    "total": 25000,
    "input": 15000,
    "output": 10000,
    "reasoning": 3000,
    "cache": { "read": 2000, "write": 1000 },
    "by_model": {
      "claude-sonnet": {
        "total": 18000,
        "input": 10000,
        "output": 8000,
        "reasoning": 2500,
        "cache": { "read": 1500, "write": 800 }
      },
      "gpt-4o": {
        "total": 7000,
        "input": 5000,
        "output": 2000,
        "reasoning": 500,
        "cache": { "read": 500, "write": 200 }
      }
    }
  },
  
  "cost_usd": {
    "total": 0.25,
    "by_model": {
      "claude-sonnet": 0.18,
      "gpt-4o": 0.07
    }
  },
  
  "tools": {
    "total_calls": 45,
    "errors": 2,
    "by_tool": {
      "read_file": 15,
      "bash": 20,
      "write_file": 10
    }
  },
  
  "files": {
    "edited": 12,
    "lines_added": 500,
    "lines_deleted": 100
  },
  
  "agents": {
    "build": { "sessions": 3, "tokens": 15000 },
    "plan": { "sessions": 2, "tokens": 10000 }
  },
  
  "errors": {
    "total": 3,
    "by_type": {
      "ProviderAuthError": 1,
      "ApiError": 2
    }
  }
}
```

---

## 6. Real-time Updates（实时更新层）

### 6.1 架构概览

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Real-time Update Flow                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   OpenCode Event                                                        │
│         │                                                               │
│         ▼                                                               │
│   ┌──────────────┐      ┌──────────────┐      ┌──────────────┐        │
│   │   Ingestion  │ ──▶ │  Event Store │ ──▶ │  Projection  │        │
│   │   Pipeline   │      │  (持久化)     │      │   Engine     │        │
│   └──────────────┘      └──────────────┘      └──────────────┘        │
│         │                                               │              │
│         ▼                                               ▼              │
│   ┌──────────────┐                              ┌──────────────┐      │
│   │  SSE Push    │                              │   Database   │      │
│   │  (实时通知)   │                              │   (持久化)    │      │
│   └──────────────┘                              └──────────────┘      │
│         │                                               │              │
│         ▼                                               ▼              │
│   ┌──────────────┐                              ┌──────────────┐      │
│   │   Frontend   │ ◀────────────────────────────│  API Query   │      │
│   │   (UI 更新)   │   用户主动刷新时查询         │  (按需查询)   │      │
│   └──────────────┘                              └──────────────┘      │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 6.2 实时更新策略

**双通道设计**：

| 通道 | 用途 | 触发时机 | 数据内容 |
|------|------|---------|---------|
| **SSE Push** | 通知前端有新数据 | 每次事件入库后 | 仅通知（event_id + timestamp） |
| **API Query** | 获取实际数据 | 用户主动刷新/轮询 | 完整统计数据 |

**设计原则**：
- SSE 仅用于**通知**，不传输实际数据
- 前端收到通知后，**用户主动刷新**才查询数据库
- 避免 SSE 传输大量数据，降低带宽消耗
- 保证数据一致性（数据库是唯一数据源）

### 6.3 SSE 事件格式

```typescript
// SSE 消息格式（优化后）
interface StatsUpdate {
  event_id: string           // 事件 ID
  timestamp: string          // ISO 时间戳
  
  // 事件分类
  type: 'session' | 'tool' | 'message' | 'error' | 'file'
  action: 'created' | 'updated' | 'deleted'
  session_id?: string        // 关联的会话 ID
  
  // 增量数据（可选）
  delta?: {
    tokens?: number          // Token 增量
    cost_usd?: number        // 成本增量
    tool_calls?: number      // 工具调用增量
    errors?: number          // 错误增量
  }
}

// SSE 帧格式
// event: stats-update
// id: {event_id}
// data: {JSON}\n\n
```

**示例消息**：

```
event: stats-update
id: evt-abc123
data: {"event_id":"evt-abc123","timestamp":"2026-06-04T10:30:00Z","type":"message","action":"updated","session_id":"ses_xyz789","delta":{"tokens":1500,"cost_usd":0.015}}
```

### 6.4 前端集成

```typescript
// 前端 SSE 监听
const eventSource = new EventSource('/api/v1/events/stream')

eventSource.addEventListener('stats-update', (event) => {
  const data = JSON.parse(event.data) as StatsUpdate
  
  // 根据类型更新不同区域
  switch (data.type) {
    case 'session':
      // 会话变更，刷新会话列表
      refreshSessionList(data.session_id)
      break
      
    case 'tool':
      // 工具调用，刷新工具统计
      refreshToolStats()
      break
      
    case 'message':
      // 消息更新，直接用 delta 更新指标卡
      if (data.delta) {
        incrementTokenCount(data.delta.tokens)
        incrementCost(data.delta.cost_usd)
      }
      break
      
    case 'error':
      // 错误发生，刷新错误统计
      refreshErrorStats()
      break
      
    case 'file':
      // 文件编辑，刷新文件统计
      refreshFileStats()
      break
  }
  
  // 更新最后同步时间
  updateLastSyncTime(data.timestamp)
})

// 页面可见性变化时检查更新
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    checkForUpdates()
  }
})
```

### 6.5 SSE 端点

```
GET /api/v1/events/stream
```

**响应头**：
```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

**响应体**（SSE 流）：
```
: keepalive

event: stats-update
id: evt-abc123
data: {"last_event_id":"evt-abc123","updated_at":"2026-06-04T10:30:00Z"}

: keepalive

event: stats-update
id: evt-def456
data: {"last_event_id":"evt-def456","updated_at":"2026-06-04T10:31:00Z"}
```

### 6.6 事件处理流程

```typescript
async function handleIngestEvent(event: Event): Promise<void> {
  // 1. 写入 Event Store
  await insertEvent(event)
  
  // 2. 更新 Projections
  await updateProjections(event)
  
  // 3. 检查是否需要生成快照
  await checkAndGenerateSnapshots(event)
  
  // 4. 构建 SSE 更新消息
  const update = buildStatsUpdate(event)
  
  // 5. 广播 SSE 通知
  broadcaster.broadcast(update)
}

// 构建 SSE 更新消息
function buildStatsUpdate(event: Event): StatsUpdate {
  const base = {
    event_id: event.event_id,
    timestamp: new Date().toISOString(),
  }
  
  switch (event.event_type) {
    case 'session.created':
      return {
        ...base,
        type: 'session',
        action: 'created',
        session_id: event.session_id,
      }
      
    case 'session.deleted':
      return {
        ...base,
        type: 'session',
        action: 'deleted',
        session_id: event.session_id,
      }
      
    case 'usage.updated':
      return {
        ...base,
        type: 'message',
        action: 'updated',
        session_id: event.session_id,
        delta: {
          tokens: event.total_tokens,
          cost_usd: event.cost_usd,
        },
      }
      
    case 'tool.started':
    case 'tool.completed':
      return {
        ...base,
        type: 'tool',
        action: event.event_type === 'tool.started' ? 'created' : 'updated',
        session_id: event.session_id,
        delta: {
          tool_calls: 1,
        },
      }
      
    case 'tool.failed':
      return {
        ...base,
        type: 'error',
        action: 'created',
        session_id: event.session_id,
        delta: {
          errors: 1,
        },
      }
      
    default:
      return {
        ...base,
        type: 'session',
        action: 'updated',
        session_id: event.session_id,
      }
  }
}
```

---

## 7. Query Layer（查询层）

### 7.1 API 端点

| 端点 | 说明 | 数据来源 |
|------|------|----------|
| `GET /api/v1/stats/overview` | 总览统计 | projection_daily 聚合 |
| `GET /api/v1/stats/trend` | 趋势数据 | projection_daily |
| `GET /api/v1/stats/sessions` | 会话列表 | projection_sessions |
| `GET /api/v1/stats/sessions/:id` | 会话详情 | projection_sessions + events |
| `GET /api/v1/stats/tools` | 工具统计 | projection_tool_calls |
| `GET /api/v1/stats/models` | 模型对比 | projection_daily 聚合 |
| `GET /api/v1/stats/projects` | 项目对比 | projection_daily 聚合 |
| `GET /api/v1/stats/errors` | 错误统计 | events 过滤 |

### 7.2 路由结构

```
/api/v1/
├── stats/
│   ├── overview          # 总览统计
│   ├── trend             # 趋势数据
│   ├── sessions/
│   │   ├── /             # 会话列表
│   │   └── /:id          # 会话详情
│   ├── tools             # 工具统计
│   ├── models            # 模型对比
│   ├── projects          # 项目对比
│   └── errors            # 错误统计
```

### 7.3 查询参数

```typescript
interface StatsQuery {
  // 时间范围
  timeRange?: {
    start: number;      // 时间戳
    end: number;
  };
  
  // 过滤条件
  filters?: {
    project?: string;
    model?: string;
    status?: string;
    agent?: string;
  };
  
  // 聚合维度
  groupBy?: ('date' | 'project' | 'model' | 'agent')[];
  
  // 排序
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  
  // 分页
  limit?: number;
  offset?: number;
}
```

### 7.4 查询流程

```
前端请求
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│                    Query Engine                          │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  1. 解析查询参数                                         │
│     │                                                   │
│     ▼                                                   │
│  2. 检查快照缓存                                         │
│     │                                                   │
│     ├─▶ 缓存命中 → 直接返回                             │
│     │                                                   │
│     └─▶ 缓存未命中 → 继续                               │
│           │                                             │
│           ▼                                             │
│  3. 判断数据来源                                         │
│     │                                                   │
│     ├─▶ 实时数据（最近 1 小时）                           │
│     │   → 查询 events 表                                │
│     │                                                   │
│     ├─▶ 近期数据（最近 30 天）                           │
│     │   → 查询 projection_daily 表                      │
│     │                                                   │
│     └─▶ 历史数据（30 天前）                              │
│         → 查询 snapshots 表 + 增量 events               │
│                                                         │
│  4. 合并计算                                            │
│     │                                                   │
│     ▼                                                   │
│  5. 更新快照缓存（如果需要）                             │
│     │                                                   │
│     ▼                                                   │
│  6. 返回结果                                             │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 7.5 查询示例

**查询本月统计**：
```typescript
async function getMonthlyStats(yearMonth: string): Promise<MonthlyStats> {
  // 1. 检查快照
  const snapshot = await getSnapshot('monthly', yearMonth);
  
  if (snapshot && await isSnapshotValid('monthly', yearMonth)) {
    // 快照有效，直接返回
    return snapshot.data;
  }
  
  // 2. 计算本月时间范围
  const { start, end } = getMonthRange(yearMonth);
  
  // 3. 查询 projection_daily
  const dailyData = await db.query(`
    SELECT * FROM projection_daily
    WHERE date BETWEEN ? AND ?
    ORDER BY date
  `, [start, end]);
  
  // 4. 聚合计算
  const result = aggregateDailyToMonthly(dailyData);
  
  // 5. 保存快照
  await saveSnapshot('monthly', yearMonth, result);
  
  return result;
}
```

**查询模型对比**：
```typescript
async function getModelComparison(
  timeRange: TimeRange
): Promise<ModelComparison[]> {
  const { start, end } = timeRange;
  
  const data = await db.query(`
    SELECT 
      model,
      SUM(total_tokens) as tokens,
      SUM(total_cost_usd) as cost,
      SUM(message_count) as messages,
      SUM(tool_calls) as tools,
      SUM(lines_added + lines_deleted) as code_changes
    FROM projection_daily
    WHERE date BETWEEN ? AND ?
    GROUP BY model
    ORDER BY cost DESC
  `, [start, end]);
  
  return data;
}
```

**查询趋势**：
```typescript
async function getTrend(
  timeRange: TimeRange,
  granularity: 'day' | 'week' | 'month'
): Promise<TrendData[]> {
  const { start, end } = timeRange;
  
  if (granularity === 'day') {
    return await db.query(`
      SELECT 
        date,
        SUM(total_tokens) as tokens,
        SUM(total_cost_usd) as cost,
        SUM(message_count) as messages
      FROM projection_daily
      WHERE date BETWEEN ? AND ?
      GROUP BY date
      ORDER BY date
    `, [start, end]);
  }
  
  if (granularity === 'week') {
    return await db.query(`
      SELECT 
        strftime('%Y-W%W', date) as week,
        SUM(total_tokens) as tokens,
        SUM(total_cost_usd) as cost,
        SUM(message_count) as messages
      FROM projection_daily
      WHERE date BETWEEN ? AND ?
      GROUP BY week
      ORDER BY week
    `, [start, end]);
  }
  
  return await db.query(`
    SELECT 
      strftime('%Y-%m', date) as month,
      SUM(total_tokens) as tokens,
      SUM(total_cost_usd) as cost,
      SUM(message_count) as messages
    FROM projection_daily
    WHERE date BETWEEN ? AND ?
    GROUP BY month
    ORDER BY month
  `, [start, end]);
}
```

---

## 8. 统计能力总结

### 7.1 可实现的统计维度

| 统计维度 | 查询示例 | 数据来源 |
|---------|---------|----------|
| **成本分析** | 按模型/Agent/会话统计 token 消耗和成本 | projection_sessions |
| **效率分析** | 每小时消息数、平均响应时间、工具执行效率 | projection_daily |
| **质量分析** | 错误率、重试率、回滚率 | projection_sessions |
| **使用模式** | 高频命令、常用工具、活跃时段、会话时长分布 | projection_daily |
| **文件热点** | 最常编辑的文件、变更行数分布、文件类型分布 | projection_sessions |
| **Agent 效能** | 各 Agent 完成任务数、成本对比、错误率对比 | projection_sessions |
| **错误诊断** | 错误类型 Top N、错误时间分布、关联的模型/Provider | events |
| **对话分析** | 用户/消息比例、对话轮次、单轮 token 消耗 | projection_sessions |

### 7.2 对比分析能力

| 对比维度 | 实现方式 |
|---------|---------|
| **时间对比** | 今天 vs 昨天、本周 vs 上周、本月 vs 上月 |
| **模型对比** | 不同模型的效率/成本对比 |
| **项目对比** | 不同项目的使用量/效率对比 |

### 7.3 实时 vs 历史

| 场景 | 数据来源 | 响应时间 |
|------|---------|---------|
| 实时监控（最近 1 小时） | events 表 | 毫秒级 |
| 近期趋势（最近 30 天） | projection_daily | 毫秒级 |
| 历史查询（30 天前） | snapshots + 增量 events | 秒级 |

---

## 9. 实施计划

### Phase 1: Event Store
- [ ] 创建 events 表
- [ ] 实现事件摄入管道
- [ ] 实现幂等写入

### Phase 2: Projections
- [ ] 创建 projection_sessions 表
- [ ] 创建 projection_daily 表
- [ ] 创建 projection_tool_calls 表
- [ ] 实现投影引擎

### Phase 3: Snapshots
- [ ] 创建 snapshots 表
- [ ] 实现事件驱动快照生成
- [ ] 实现查询时补全逻辑

### Phase 4: Query Layer
- [ ] 实现 API 端点
- [ ] 实现查询引擎
- [ ] 实现快照缓存

### Phase 5: 前端集成
- [ ] 更新前端 API 调用
- [ ] 实现新的统计图表
- [ ] 实现对比分析视图

---

## 10. 设计决策

| 问题 | 决策 | 说明 |
|------|------|------|
| 数据迁移 | 不迁移 | 当全新数据处理，不考虑历史数据 |
| 数据清理 | 不自动删除 | 后续可在 Dashboard 中提供手动清理功能 |
| 导出功能 | 暂不实现 | 后续按需添加 |

### 9.1 projection_daily 的 agent_usage 字段

与 `projection_sessions` 使用相同的 JSON 结构：

```json
{
  "build": {
    "message_count": 8,
    "tokens": {
      "total": 2000,
      "input": 1200,
      "output": 800,
      "reasoning": 300,
      "cache": {
        "read": 200,
        "write": 100
      }
    },
    "cost_usd": 0.020
  },
  "plan": {
    "message_count": 3,
    "tokens": {
      "total": 500,
      "input": 300,
      "output": 200,
      "reasoning": 50,
      "cache": {
        "read": 50,
        "write": 20
      }
    },
    "cost_usd": 0.005
  }
}
```

---

## 11. Dashboard UI 设计

### 11.1 整体布局

**导航模式**：顶部导航（水平导航栏）

**布局结构**：
```
┌─────────────────────────────────────────────────────────────────────────┐
│ Logo | Overview | Efficiency | Models | Projects | Tools | Sessions     │  ← 顶部导航
├─────────────────────────────────────────────────────────────────────────┤
│ [SSE ●] [数据状态]                                    [刷新] [设置]    │  ← 状态栏
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│                              主内容区                                    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**页面清单**：

| 页面 | 用途 | 数据来源 |
|------|------|----------|
| Overview | 总览仪表板 | projection_daily 聚合 |
| Efficiency | 效率分析 | projection_sessions + projection_daily |
| Models | 模型对比 | projection_daily 按 model 聚合 |
| Projects | 项目对比 | projection_daily 按 project 聚合 |
| Tools | 工具统计 | projection_tool_calls |
| Sessions | 会话详情 | projection_sessions |

---

### 11.2 Overview 页面

**布局**：指标卡 + 趋势图 + 快速入口

```
┌─────────────────────────────────────────────────────────────────────────┐
│ [SSE ●] 数据已同步                                   [刷新] [设置]     │
├─────────────────────────────────────────────────────────────────────────┤
│ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐           │
│ │ 总会话  │ │ 总Token │ │ 总成本  │ │ 工具调用│ │ 代码变更│           │
│ │  128    │ │  1.2M   │ │ $12.34  │ │  2,456  │ │  +500   │           │
│ │+12 本周 │ │入800K出 │ │今日$1.23│ │ 42 错误 │ │  -100   │           │
│ └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│                          使用趋势图（7天/30天/全部）                     │
│                                                                         │
├─────────────────────────────────────┬───────────────────────────────────┤
│           模型成本分布               │         项目使用排行              │
│     （饼图或环形图）                 │      （柱状图，Top 5）            │
│                                     │                                   │
├─────────────────────────────────────┼───────────────────────────────────┤
│          工具调用 Top 5             │         近期会话                  │
│       （水平柱状图）                │      （列表，最新 10 条）          │
│                                     │                                   │
└─────────────────────────────────────┴───────────────────────────────────┘
```

**指标卡详情**：

| 指标 | 主数值 | 辅助信息 | 趋势 |
|------|--------|---------|------|
| 总会话 | 128 | 105 活跃 · 23 已删除 | +12 本周 |
| 总 Token | 1.2M | 输入 800K · 输出 400K | ↑ 15% |
| 总成本 | $12.34 | 今日 $1.23 · 本周 $4.56 | ↓ 5% |
| 工具调用 | 2,456 | 成功率 98.3% | +156 今日 |
| 代码变更 | +500 / -100 | 净增 400 行 | +50 今日 |

---

### 11.3 Efficiency 页面

**布局**：效率指标 + 时间分布 + 对比分析

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        效率分析                          [时间范围 ▼]   │
├─────────────────────────────────────────────────────────────────────────┤
│ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐       │
│ │ 平均会话时长│ │ 每任务成本  │ │ Token利用率 │ │ 错误率      │       │
│ │   25 分钟   │ │   $0.096    │ │   78.5%     │ │   1.7%      │       │
│ │ ↓ 3min      │ │ ↓ $0.012    │ │ ↑ 2.3%      │ │ ↓ 0.5%      │       │
│ └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│                      工作时段分布（热力图）                              │
│                      X轴: 小时 (0-23)                                   │
│                      Y轴: 星期 (Mon-Sun)                                │
│                                                                         │
├─────────────────────────────────────┬───────────────────────────────────┤
│          消息轮次效率               │         响应时间分布              │
│   （每轮对话平均 token 消耗）       │      （P50/P90/P99）              │
│                                     │                                   │
├─────────────────────────────────────┼───────────────────────────────────┤
│          任务完成率                 │         代码产出效率              │
│   （成功/失败/取消）                │   （每千 token 产出代码行数）      │
│                                     │                                   │
└─────────────────────────────────────┴───────────────────────────────────┘
```

**效率指标**：

| 指标 | 计算公式 | 说明 |
|------|---------|------|
| 平均会话时长 | `SUM(duration_ms) / COUNT(sessions)` | 会话效率 |
| 每任务成本 | `total_cost / session_count` | 成本效率 |
| Token 利用率 | `output_tokens / total_tokens` | Token 效率 |
| 错误率 | `error_count / message_count` | 质量指标 |
| 每千行成本 | `total_cost / (lines_added + lines_deleted) * 1000` | 代码成本 |

---

### 11.4 Models 页面

**布局**：模型对比表 + 详细指标

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        模型对比                          [时间范围 ▼]   │
├─────────────────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────────────────────────┐ │
│ │ 模型对比表格                                                        │ │
│ ├──────────────┬──────────┬──────────┬──────────┬──────────┬──────────┤ │
│ │ 模型         │ 会话数   │ Token    │ 成本     │ 平均时长 │ 错误率   │ │
│ ├──────────────┼──────────┼──────────┼──────────┼──────────┼──────────┤ │
│ │ claude-sonnet│ 85       │ 800K     │ $8.50    │ 22min    │ 1.2%     │ │
│ │ gpt-4o       │ 43       │ 400K     │ $3.84    │ 28min    │ 2.3%     │ │
│ └──────────────┴──────────┴──────────┴──────────┴──────────┴──────────┘ │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│                      Token 细分对比（堆叠柱状图）                       │
│                      每个模型: input + output + reasoning               │
│                                                                         │
├─────────────────────────────────────┬───────────────────────────────────┤
│          成本趋势                   │         性价比分析                │
│   （折线图，每个模型一条线）        │   （成本 vs 产出散点图）          │
│                                     │                                   │
└─────────────────────────────────────┴───────────────────────────────────┘
```

**对比维度**：

| 维度 | 指标 |
|------|------|
| 使用量 | 会话数、消息数、Token 总数 |
| 成本 | 总成本、平均每会话成本、每千行成本 |
| 效率 | 平均会话时长、Token 利用率、响应时间 |
| 质量 | 错误率、重试率、任务完成率 |

---

### 11.5 Projects 页面

**布局**：项目列表 + 项目详情

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        项目对比                          [时间范围 ▼]   │
├─────────────────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────────────────────────┐ │
│ │ 项目列表                                                            │ │
│ ├──────────────────┬──────────┬──────────┬──────────┬─────────────────┤ │
│ │ 项目路径         │ 会话数   │ Token    │ 成本     │ 最后活跃        │ │
│ ├──────────────────┼──────────┼──────────┼──────────┼─────────────────┤ │
│ │ ~/project-a      │ 45       │ 500K     │ $5.20    │ 2 小时前        │ │
│ │ ~/project-b      │ 35       │ 350K     │ $3.50    │ 1 天前          │ │
│ │ ~/project-c      │ 48       │ 350K     │ $3.64    │ 3 天前          │ │
│ └──────────────────┴──────────┴──────────┴──────────┴─────────────────┘ │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│                      项目活跃度趋势（折线图）                           │
│                                                                         │
├─────────────────────────────────────┬───────────────────────────────────┤
│          模型使用分布               │         工具使用分布              │
│   （每个项目的模型偏好）            │   （每个项目的工具偏好）          │
│                                     │                                   │
└─────────────────────────────────────┴───────────────────────────────────┘
```

---

### 11.6 Tools 页面

**布局**：工具统计表 + 使用分析

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        工具统计                          [时间范围 ▼]   │
├─────────────────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────────────────────────┐ │
│ │ 工具使用排行                                                        │ │
│ ├──────────────┬──────────┬──────────┬──────────┬──────────┬──────────┤ │
│ │ 工具名称     │ 调用次数 │ 成功率   │ 平均耗时 │ Token    │ 成本     │ │
│ ├──────────────┼──────────┼──────────┼──────────┼──────────┼──────────┤ │
│ │ bash         │ 856      │ 98.5%    │ 2.3s     │ 120K     │ $1.20    │ │
│ │ read_file    │ 654      │ 99.8%    │ 0.1s     │ 45K      │ $0.45    │ │
│ │ write_file   │ 432      │ 99.1%    │ 0.2s     │ 80K      │ $0.80    │ │
│ │ edit         │ 321      │ 97.8%    │ 0.3s     │ 60K      │ $0.60    │ │
│ └──────────────┴──────────┴──────────┴──────────┴──────────┴──────────┘ │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│                      工具使用趋势（折线图）                             │
│                                                                         │
├─────────────────────────────────────┬───────────────────────────────────┤
│          错误类型分布               │         耗时分布                  │
│   （饼图，按工具分）                │   （直方图）                      │
│                                     │                                   │
└─────────────────────────────────────┴───────────────────────────────────┘
```

---

### 11.7 Sessions 页面

**布局**：会话列表 + 会话详情

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        会话列表                    [搜索] [过滤 ▼]      │
├─────────────────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────────────────────────┐ │
│ │ 会话列表                                                            │ │
│ ├──────────────┬──────────┬──────────┬──────────┬──────────┬──────────┤ │
│ │ 会话ID       │ 项目     │ 模型     │ Token    │ 成本     │ 状态     │ │
│ ├──────────────┼──────────┼──────────┼──────────┼──────────┼──────────┤ │
│ │ ses_abc123   │ proj-a   │ claude   │ 12,345   │ $0.12    │ 活跃     │ │
│ │ ses_def456   │ proj-b   │ gpt-4o   │ 8,901    │ $0.09    │ 已删除   │ │
│ └──────────────┴──────────┴──────────┴──────────┴──────────┴──────────┘ │
│                                                                         │
│ 显示 1-50 / 共 128 条                               [上一页] [下一页]   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│ 选中会话详情: ses_abc123                                                │
│ ┌─────────────────────────────────────────────────────────────────────┐ │
│ │ 基本信息                                                            │ │
│ │ 项目: ~/project-a  |  模型: claude-sonnet  |  Agent: build          │ │
│ │ 创建: 2026-06-04 10:00  |  时长: 25 分钟  |  状态: 活跃             │ │
│ ├─────────────────────────────────────────────────────────────────────┤ │
│ │ Token 统计                                                          │ │
│ │ 总计: 12,345  |  输入: 8,000  |  输出: 4,000  |  推理: 345          │ │
│ │ 缓存读: 500  |  缓存写: 200  |  成本: $0.12                        │ │
│ ├─────────────────────────────────────────────────────────────────────┤ │
│ │ 工具调用: 15 次  |  文件编辑: 3 个  |  代码变更: +150 / -30         │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**过滤器**：

| 过滤器 | 选项 |
|--------|------|
| 状态 | 全部 / 活跃 / 已删除 |
| 模型 | 全部 / claude-sonnet / gpt-4o / ... |
| 项目 | 全部 / ~/project-a / ~/project-b / ... |
| 时间 | 今天 / 本周 / 本月 / 自定义范围 |

**排序**：

| 列 | 排序方式 |
|----|---------|
| 会话ID | 创建时间 |
| Token | 数值 |
| 成本 | 数值 |
| 最后活跃 | 时间 |

---

### 11.8 实时更新 UI

**SSE 状态指示器**：

```
┌─────────────────────────────────────────────────────────────────────────┐
│ [SSE ●] 数据已同步                          最后更新: 2 分钟前  [刷新] │
│ [SSE ●] 有新数据，点击刷新                  最后更新: 5 分钟前  [刷新] │
│ [SSE ○] 连接断开，正在重连...               最后更新: 10 分钟前 [刷新] │
└─────────────────────────────────────────────────────────────────────────┘
```

**更新策略**：

| SSE type | 更新区域 | 行为 |
|----------|---------|------|
| `session` | 会话列表、总览指标卡 | 刷新会话列表、更新会话数 |
| `message` | 总览指标卡、效率指标 | 直接用 delta 更新 Token/成本 |
| `tool` | 工具统计、总览指标卡 | 刷新工具统计、更新工具调用数 |
| `error` | 错误统计、总览指标卡 | 刷新错误统计、更新错误数 |
| `file` | 文件统计、代码变更 | 刷新文件统计、更新代码行数 |

**状态指示**：

| 状态 | 指示器 | 说明 |
|------|--------|------|
| 数据已同步 | 绿点 | 最近 5 分钟内有更新 |
| 有新数据 | 黄点 | 收到 SSE 通知，等待刷新 |
| 连接断开 | 红点 | SSE 连接断开，自动重连中 |

---

### 11.9 响应式设计

**断点**：

| 断点 | 宽度 | 布局调整 |
|------|------|---------|
| 桌面 | ≥1280px | 完整布局 |
| 平板 | 768-1279px | 指标卡 2x2，图表单列 |
| 手机 | <768px | 指标卡单列，图表全宽 |

---

**文档版本**: v1.1  
**最后更新**: 2026-06-04
