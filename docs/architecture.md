# OpenCode Stats Engine 架构文档

> 本文档覆盖插件的核心架构: 事件采集、持久化、投影统计。
> **不涉及** `src/api/` 和 `src/sse/` 的内部实现, 它们仅作为数据流边界出现。

---

## 文档范围

| 范围内 | 范围外 |
|--------|--------|
| 插件入口与生命周期 (`src/index.ts`) | HTTP 路由 (`src/api/`) |
| 事件转换 (`src/event/`) | SSE 广播内部 (`src/sse/`) |
| 事件存储 (`src/store/`) | 仪表盘 (`dashboard/`) |
| 投影引擎与处理器 (`src/projection/`) | |
| 数据库 schema 与迁移 (`src/db/`) | |
| 类型定义与不变量 (`src/types/`) | |

---

## 架构目标

| 目标 | 实现手段 |
|------|----------|
| 事件溯源: 所有状态可追溯、可重放 | 追加式事件表, 投影表从事件派生 |
| 幂等写入 | `INSERT OR IGNORE` + 内存 `processedEvents` 集合 |
| 错误隔离 | `processEvent` 四阶段独立 try/catch |
| 事务安全 | 投影处理器在 `db.transaction()` 内执行, 失败自动回滚 |
| 隐私保护 | `FORBIDDEN_METADATA_KEYS` 禁止敏感字段进入元数据 |

---

## 总体数据流

```
OpenCode SDK Event
       |
  convertEvent()         -- src/event/converter.ts
       |
  StatsEvent[]
       |
  +---------+------------------+
  |                            |
  v                            v
EventStore.insertEvents()   ProjectionEngine.processEvents()
  |                            |
  v                            v
events 表                  +--------+--------+
                           |        |        |
                           v        v        v
                        sessions messages tool_calls
                        handler  handler  handler
                           |        |        |
                           v        v        v
                        sessions messages tool_calls
                          表       表       表
                           |
                           v
                     broadcast (边界输出, 不在本文档范围)
```

### 单事件处理管线

`processEvent(sdkEvent, directory)` 在 `StatsPluginInstance` 中执行:

```
1. convertEvent(sdkEvent, directory)  -->  StatsEvent[]
       |
2. EventStore.insertEvents(statsEvents)   -- 幂等追加
       |
3. ProjectionEngine.processEvents(statsEvents)  -- 事务内路由
       |
4. broadcaster.broadcast(update)   -- 边界输出, 逐事件广播
```

每个阶段被独立的 `try/catch` 包裹: 一个阶段的异常不会阻断后续阶段, 也不会影响下一个事件的处理。

---

## 核心模块职责

### 插件入口 (`src/index.ts`)

`StatsPluginInstance` 是单例, 在首次插件调用时懒初始化, 跨调用复用。

职责:
- 创建 SQLite 连接, 配置 PRAGMA, 运行迁移
- 实例化 `EventStore`, `ProjectionEngine`, `SSEBroadcaster`
- 注册三个投影处理器: `sessions`, `messages`, `tool-calls`
- 启动 HTTP 服务器 (`Bun.serve`)
- 提供 `dispose()` 释放所有资源

### 事件转换器 (`src/event/`)

**注册表** (`converter.ts`): `Map<string, ConvertFn[]>`, 一个 SDK 事件类型可映射多个转换函数 (1:N)。

**转换器** (`converters/`): 每个文件导出 `eventType` + `convert`, 共 10 个:

| 转换器文件 | SDK 事件类型 | 输出 StatsEvent 类型 |
|-----------|-------------|---------------------|
| `session-created` | `session.created` | `session.created` |
| `session-updated` | `session.updated` | `session.updated` |
| `session-deleted` | `session.deleted` | `session.deleted` |
| `session-error` | `session.error` | `session.error` |
| `message-updated-user` | `message.updated` | `message.updated.user` |
| `message-updated-assistant` | `message.updated` | `message.updated.assistant` |
| `message-part-updated-tool-pending` | `message.part.updated` | `tool.execute.pending` |
| `message-part-updated-tool-running` | `message.part.updated` | `tool.execute.running` |
| `message-part-updated-tool-completed` | `message.part.updated` | `tool.execute.completed` |
| `message-part-updated-tool-failed` | `message.part.updated` | `tool.execute.failed` |

**工具函数** (`utils.ts`):
- `createBaseEvent()` -- 生成 `event_id` (UUID) + `created_at_ms` (当前时间戳)
- `defaultTokens()` -- 零值 `TokenBreakdown`
- `normalizeTokens()` -- 从松散输入构造合法 `TokenBreakdown`

### 事件存储 (`src/store/event.ts`)

追加式持久化层。核心设计:

- **INSERT OR IGNORE**: 重复 `event_id` 静默跳过, 实现幂等
- **预编译语句缓存**: `queryCache` Map 缓存动态 SQL, 避免重复编译
- **批量写入**: `insertEvents()` 在单事务中逐条插入

事件存储为不可变: 写入后不修改、不删除。

### 投影引擎 (`src/projection/engine.ts`)

路由事件到匹配的处理器, 在事务中执行。

**核心流程:**
1. 内存幂等检查 (`processedEvents: Set<string>`, 上限 10,000 条)
2. 超过上限时 `clear()` 整个集合 (依赖 EventStore 层的 `INSERT OR IGNORE` 作为持久层幂等保障)
3. 按 `event_type` 查找 `handles` 数组包含该类型的处理器
4. 在 `db.transaction()` 中依次调用匹配的处理器
5. 事务成功后标记 `event_id` 为已处理

**TransactionContext**: 处理器通过 `run()`, `query()`, `get()` 三个方法操作数据库, 所有操作共享同一事务。处理器抛异常则整个事务回滚。

---

## 事件模型与转换机制

### StatsEvent 类型 (10 种)

```
session.created          -- 会话创建
session.updated          -- 会话更新 (标题等)
session.deleted          -- 会话删除
session.error            -- 会话错误
message.updated.user     -- 用户消息 (diff/行统计)
message.updated.assistant -- 助手消息 (token/费用)
tool.execute.pending     -- 工具等待执行
tool.execute.running     -- 工具执行中
tool.execute.completed   -- 工具执行完成
tool.execute.failed      -- 工具执行失败
```

所有事件共享 `BaseStatsEvent`:
- `event_id: string` -- UUID, 幂等键
- `created_at_ms: number` -- 毫秒时间戳

### 转换机制

一个 SDK 事件经 `convertEvent()` 可产生零到多个 StatsEvent:

```
SDK "message.updated"  -->  [MessageUpdatedUserEvent, MessageUpdatedAssistantEvent]
SDK "message.part.updated"  -->  [ToolExecutePendingEvent]  (根据状态分发)
```

转换器自行决定如何从 SDK Event 的 `properties` 中提取字段。未注册的 SDK 事件类型返回空数组。

### 隐私边界

`FORBIDDEN_METADATA_KEYS` 禁止以下字段出现在事件元数据中:
`tool_input`, `tool_output`, `message_body`, `raw_input`, `raw_output`

---

## 存储与投影模型

### 数据库配置

| PRAGMA | 值 | 效果 |
|--------|-----|------|
| `journal_mode` | WAL | 并发读 + 单写 |
| `synchronous` | NORMAL | WAL 模式下的良好耐久性 |

### 表结构

#### events (事件表)

| 字段 | 类型 | 说明 |
|------|------|------|
| `event_id` | TEXT PK | 幂等键 |
| `event_type` | TEXT NOT NULL | 事件类型 |
| `session_id` | TEXT NOT NULL | 关联会话 |
| `event_contents` | TEXT | JSON, 排除 event_id/event_type/created_at_ms 后的剩余字段 |
| `created_at` | DATETIME | 自动填充 |
| `created_at_ms` | INTEGER NOT NULL | 毫秒时间戳 |

#### sessions (会话投影表)

| 字段 | 类型 | 说明 |
|------|------|------|
| `session_id` | TEXT PK | 会话 ID |
| `project_path` | TEXT | 项目路径 |
| `title` | TEXT | 会话标题 |
| `status` | TEXT | `active` / `deleted` |
| `deleted_at_ms` | INTEGER | 删除时间戳 |
| `first_event_at_ms` | INTEGER | 首个事件时间 |
| `last_event_at_ms` | INTEGER | 最后事件时间 |
| `duration_ms` | INTEGER | `last_event_at_ms - first_event_at_ms` |
| `created_at` | DATETIME | 创建时间 |

#### messages (消息投影表)

| 字段类别 | 字段 |
|---------|------|
| 主键 | `message_id` |
| 关联 | `event_id`, `session_id` |
| 维度 | `project_path`, `model`, `role`, `agent` |
| Token | `input_tokens`, `output_tokens`, `reasoning_tokens`, `cache_read`, `cache_write`, `total_tokens` |
| 费用 | `cost_usd` |
| 代码变更 | `lines_added`, `lines_deleted`, `files_changed` |
| 时间 | `created_at_ms`, `completed_at_ms`, `duration_ms` |
| 状态 | `finish_reason`, `has_error`, `error_type` |

#### tool_calls (工具调用投影表)

| 字段 | 类型 | 说明 |
|------|------|------|
| `call_id` | TEXT PK | 调用 ID |
| `session_id` | TEXT | 关联会话 |
| `tool_name` | TEXT | 工具名称 |
| `status` | TEXT | `running` / `completed` / `error` |
| `started_at_ms` | INTEGER | 开始时间 |
| `completed_at_ms` | INTEGER | 完成时间 |
| `duration_ms` | INTEGER | 持续时长 |
| `title` | TEXT | 结果标题 |
| `error_message` | TEXT | 错误信息 |
| `created_at` | DATETIME | 创建时间 |
| `updated_at` | DATETIME | 更新时间 |

### 投影处理器映射

| 处理器 | handles (事件类型) | 核心行为 |
|--------|-------------------|----------|
| `sessions` | 全部 10 种 | `session.created` 插入; 其余更新 `last_event_at_ms` 和 `duration_ms`; `message.*`/`tool.*` 事件通过 `ensureSessionExists()` 保证会话行存在 |
| `messages` | `message.updated.user`, `message.updated.assistant` | INSERT OR REPLACE, 每条事件一行; assistant 消息记录 token/费用, user 消息记录 diff 统计 |
| `tool-calls` | `tool.execute.pending/running/completed/failed` | `pending` 插入 running 状态行; `completed`/`failed` 通过 `upsertToolCall()` 更新; `running` 当前为 no-op |

### 迁移系统

- 迁移文件: `src/db/migrations/001_initial.ts` (当前唯一迁移)
- 跟踪表: `schema_migrations` (version INTEGER PK, applied_at DATETIME)
- `runMigrations(db)` 在单事务中执行所有未应用的迁移, 幂等可重入

---

## 关键不变量

1. **事件不可变**: 写入 events 表后不修改、不删除
2. **幂等双重保障**: 内存 `processedEvents` Set (上限 10,000) + 持久层 `INSERT OR IGNORE`
3. **事务原子性**: 单个事件的所有投影操作在同一事务中, 任一失败则全部回滚
4. **错误隔离**: `processEvent` 中 convert/store/project/broadcast 四阶段独立 try/catch, 互不阻断
5. **会话存在性**: `ensureSessionExists()` 保证 message/tool 事件到达时目标会话行已存在
6. **隐私红线**: `FORBIDDEN_METADATA_KEYS` 中的字段不得出现在事件元数据

---

## 扩展指南

### 新增事件类型

1. 在 `src/types/events.ts` 的 `StatsEvent` 联合类型中添加接口
2. 创建 `src/event/converters/my-event.ts`, 导出 `eventType` + `convert`
3. 在 `src/event/converter.ts` 的 `REGISTERED` 数组中注册
4. 在相关投影处理器的 `handles` 数组中添加该事件类型
5. 如需新列, 添加新迁移文件并更新 `schema.ts` 中的 `MIGRATIONS` 数组

### 新增投影处理器

1. 创建 `src/projection/my-handler.ts`
2. 实现 `ProjectionHandler` 接口 (`handles` 数组 + `handle` 方法)
3. 在 `src/index.ts` 的 `StatsPluginInstance` 构造函数中调用 `registerHandler()`

### 注意事项

- 转换器支持 1:N 映射 (一个 SDK 事件产生多个 StatsEvent), 新增转换器时考虑是否需要拆分
- 投影处理器在事务中运行, 不应执行耗时操作或外部调用
- `processedEvents` Set 在达到 10,000 条时整体清空, 依赖持久层幂等保障

---

## 验证建议

以下命令用于验证架构各层的正确性 (不保证测试文件当前存在):

```bash
# 类型检查
bun run typecheck

# 代码检查
bun run biome:check

# 运行测试 (如存在)
bun test

# 运行特定模块测试 (如存在)
bun test tests/projection/
bun test tests/store/
bun test tests/events/
```

建议验证策略:
- 用内存数据库 (`new Database(":memory:")`) 隔离测试投影逻辑
- 验证幂等性: 对同一 `event_id` 重复写入应返回 `changes === 0`
- 验证事务回滚: 处理器抛异常后数据库应保持原状
- 验证错误隔离: 一个阶段的失败不应阻断后续阶段

---

## 已知注意事项

1. **`processedEvents` 清空策略**: 达到 10,000 条时整体 `clear()`, 短窗口内可能有重复投影, 依赖持久层幂等保障正确性
2. **`tool.execute.running` 当前为 no-op**: tool-calls 处理器声明处理此事件但不执行任何操作
3. **迁移注释与实际不符**: `001_initial.ts` 注释提及 "5 core tables" 和 `snapshots` 表, 但实际只创建了 4 张表 (events, sessions, messages, tool_calls)
