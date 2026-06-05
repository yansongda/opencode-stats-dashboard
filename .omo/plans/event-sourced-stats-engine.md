# Event Sourced Stats Engine 实施计划

## TL;DR

> **Quick Summary**: 将 OpenCode Stats Dashboard 从基础用量监控升级为事件溯源架构的个人效率分析平台，支持实时监控 + 历史趋势 + 多维对比。
> 
> **Deliverables**:
> - Event Store（事件存储层）
> - Projections（投影层：sessions, daily, tool_calls）
> - Snapshots（快照层）
> - Query Layer（查询层 + REST API）
> - Real-time Updates（SSE 实时推送）
> - Dashboard UI（6 个页面 + ECharts 图表）
> 
> **Estimated Effort**: XL（2-3 周）
> **Parallel Execution**: YES - 5 waves
> **Critical Path**: Task 1 → Task 5 → Task 8 → Task 12 → Task 16 → Task 22 → F1-F4 → user okay

---

## Context

### Original Request
用户要求根据设计文档 `docs/superpowers/specs/2026-06-04-event-sourced-stats-engine-design.md` 生成实施计划。用户明确表示：不考虑历史数据，可以当一个完全全新的项目来处理，当前的 codebase 也可以完全摒弃掉。

### Interview Summary
**Key Discussions**:
- **测试策略**: TDD (测试驱动开发)
- **图表库**: ECharts
- **实时更新策略**: 自动刷新（收到 SSE 通知后自动查询并更新 UI）
- **实施范围**: 分阶段实施（5 个阶段）
- **现有数据处理**: 完全摒弃，全新项目

**Research Findings**:
- 现有技术栈: Bun + TypeScript + SQLite (后端), Vue 3 + Vite + TypeScript (前端)
- 设计文档包含完整的架构设计、表结构、API 设计、前端页面设计
- 需要引入 ECharts 图表库

### Metis Review
**Identified Gaps** (addressed):
- 现有架构已经是轻量级 Event Sourcing → 决定完全重新设计
- 事件类型缺口（当前 6 种，设计 30 种）→ 作为全新项目，按设计文档实现
- 无 ECharts 依赖 → 需要引入
- SSE idle timeout 陷阱 → 需要配置 Bun.serve timeout
- SQLite PRAGMA 未配置 → 需要添加 WAL 模式

---

## Work Objectives

### Core Objective
将 OpenCode Stats Dashboard 从基础用量监控升级为事件溯源架构的个人效率分析平台，支持实时监控 + 历史趋势 + 多维对比。

### Concrete Deliverables
- Event Store（events 表，30 种事件类型）
- Projections（projection_sessions, projection_daily, projection_tool_calls）
- Snapshots（snapshots 表，session/daily 快照）
- Query Layer（8 个 REST API 端点）
- Real-time Updates（SSE 双通道设计）
- Dashboard UI（6 个页面：Overview, Efficiency, Models, Projects, Tools, Sessions）

### Definition of Done
- [ ] 所有 API 端点正常响应
- [ ] 前端页面正常渲染
- [ ] SSE 实时更新正常工作
- [ ] 所有测试通过
- [ ] 无 TypeScript 类型错误

### Must Have
- Event Store 的幂等写入
- Projection 的事务性更新
- SSE 的自动重连
- 响应式设计（768px 断点）
- 空状态 UI

### Must NOT Have (Guardrails)
- 不实现数据迁移（全新项目）
- 不实现 weekly/monthly 快照（Phase 3 只做 session + daily）
- 不引入 Pinia、Tailwind 或其他新的框架/库（除 ECharts）
- 不为 Event Store 创建 OOP 抽象层（Repository/Aggregate 模式）
- 不在 SSE 中推送完整数据（保持通知模式）
- 不实现数据导出功能的变更
- 不实现用户认证/权限

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES（bun test）
- **Automated tests**: TDD
- **Framework**: bun test
- **TDD**: Each task follows RED (failing test) → GREEN (minimal impl) → REFACTOR

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.omo/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Frontend/UI**: Use Playwright (playwright skill) - Navigate, interact, assert DOM, screenshot
- **TUI/CLI**: Use interactive_bash (tmux) - Run command, send keystrokes, validate output
- **API/Backend**: Use Bash (curl) - Send requests, assert status + response fields
- **Library/Module**: Use Bash (bun/node REPL) - Import, call functions, compare output

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately - foundation + scaffolding):
├── Task 1: Project scaffolding + config [quick]
├── Task 2: SQLite schema + migrations [quick]
├── Task 3: TypeScript type definitions [quick]
├── Task 4: Event Store implementation [unspecified-high]
├── Task 5: Projection Engine foundation [unspecified-high]
└── Task 6: SSE infrastructure [quick]

Wave 2 (After Wave 1 - core projections, MAX PARALLEL):
├── Task 7: projection_sessions implementation (depends: 4, 5) [deep]
├── Task 8: projection_daily implementation (depends: 4, 5) [deep]
├── Task 9: projection_tool_calls implementation (depends: 4, 5) [unspecified-high]
├── Task 10: Snapshot system foundation (depends: 5) [unspecified-high]
└── Task 11: API Layer foundation (depends: 4, 5) [unspecified-high]

Wave 3 (After Wave 2 - API endpoints + frontend foundation):
├── Task 12: Stats API endpoints (depends: 7, 8, 9, 11) [unspecified-high]
├── Task 13: SSE endpoint + integration (depends: 6, 11) [unspecified-high]
├── Task 14: Vue 3 project scaffolding (depends: 1) [quick]
└── Task 15: ECharts integration (depends: 14) [quick]

Wave 4 (After Wave 3 - remaining pages):
├── Task 16: Overview page (depends: 12, 14, 15) [visual-engineering]
├── Task 17: Efficiency page (depends: 12, 14, 15) [visual-engineering]
├── Task 18: Models page (depends: 12, 14, 15) [visual-engineering]
├── Task 19: Projects page (depends: 12, 14, 15) [visual-engineering]
├── Task 20: Tools page (depends: 12, 14, 15) [visual-engineering]
└── Task 21: Sessions page (depends: 12, 14, 15) [visual-engineering]

Wave 5 (After Wave 4 - integration + polish):
├── Task 22: Real-time update integration (depends: 13, 16-21) [unspecified-high]
├── Task 23: Responsive design (depends: 16-21) [visual-engineering]
├── Task 24: Empty state + loading states (depends: 16-21) [visual-engineering]
└── Task 25: SSE auto-reconnect + error handling (depends: 13, 22) [unspecified-high]

Wave FINAL (After ALL tasks — 4 parallel reviews, then user okay):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Real manual QA (unspecified-high)
└── Task F4: Scope fidelity check (deep)
-> Present results -> Get explicit user okay

Critical Path: Task 1 → Task 5 → Task 8 → Task 12 → Task 16 → Task 22 → F1-F4 → user okay
Parallel Speedup: ~60% faster than sequential
Max Concurrent: 6 (Wave 1)
```

### Dependency Matrix

| Task | Depends On | Blocks | Wave |
|------|------------|--------|------|
| 1 | - | 2, 3, 14 | 1 |
| 2 | 1 | 4, 5, 7, 8, 9, 10 | 1 |
| 3 | 1 | 4, 5, 7, 8, 9, 10, 11 | 1 |
| 4 | 2, 3 | 7, 8, 9, 11, 12 | 1 |
| 5 | 2, 3 | 7, 8, 9, 10, 11 | 1 |
| 6 | - | 13 | 1 |
| 7 | 4, 5 | 12 | 2 |
| 8 | 4, 5 | 12 | 2 |
| 9 | 4, 5 | 12 | 2 |
| 10 | 5 | 22 | 2 |
| 11 | 4, 5 | 12, 13 | 2 |
| 12 | 7, 8, 9, 11 | 16, 17, 18, 19, 20, 21 | 3 |
| 13 | 6, 11 | 22, 25 | 3 |
| 14 | 1 | 15, 16, 17, 18, 19, 20, 21 | 3 |
| 15 | 14 | 16, 17, 18, 19, 20, 21 | 3 |
| 16 | 12, 14, 15 | 22, 23, 24 | 4 |
| 17 | 12, 14, 15 | 22, 23, 24 | 4 |
| 18 | 12, 14, 15 | 22, 23, 24 | 4 |
| 19 | 12, 14, 15 | 22, 23, 24 | 4 |
| 20 | 12, 14, 15 | 22, 23, 24 | 4 |
| 21 | 12, 14, 15 | 22, 23, 24 | 4 |
| 22 | 13, 16-21 | 25 | 5 |
| 23 | 16-21 | - | 5 |
| 24 | 16-21 | - | 5 |
| 25 | 13, 22 | - | 5 |

### Agent Dispatch Summary

- **Wave 1**: **6 tasks** - T1 → `quick`, T2 → `quick`, T3 → `quick`, T4 → `unspecified-high`, T5 → `unspecified-high`, T6 → `quick`
- **Wave 2**: **5 tasks** - T7 → `deep`, T8 → `deep`, T9 → `unspecified-high`, T10 → `unspecified-high`, T11 → `unspecified-high`
- **Wave 3**: **4 tasks** - T12 → `unspecified-high`, T13 → `unspecified-high`, T14 → `quick`, T15 → `quick`
- **Wave 4**: **6 tasks** - T16-T21 → `visual-engineering`
- **Wave 5**: **4 tasks** - T22 → `unspecified-high`, T23 → `visual-engineering`, T24 → `visual-engineering`, T25 → `unspecified-high`
- **FINAL**: **4 tasks** - F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep`

---

## TODOs

> Implementation + Test = ONE Task. Never separate.
> EVERY task MUST have: Recommended Agent Profile + Parallelization info + QA Scenarios.
> **A task WITHOUT QA Scenarios is INCOMPLETE. No exceptions.**
> **FORMAT**: Task labels MUST use bare numbers: `1.`, `2.`, `3.` — NOT `T1.`, `Task 1.`, `Phase 1:`.
> Final Verification Wave labels MUST use `F1.`, `F2.`, etc. — NOT `T-F1.`, `F-1.`, `Final 1.`.

- [x] 1. Project scaffolding + config

  **What to do**:
  - 初始化 Bun + TypeScript 项目
  - 配置 tsconfig.json（strict mode）
  - 配置 ESLint + Prettier
  - 创建目录结构：src/db, src/store, src/projection, src/snapshot, src/api, src/sse, src/types, dashboard/
  - 创建 package.json（依赖：bun:sqlite, @types/bun）
  - 创建基础测试文件 tests/setup.ts

  **Must NOT do**:
  - 不引入 ORM 或 query builder
  - 不引入 Tailwind、Pinia 等框架
  - 不创建过多抽象层

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 项目脚手架是标准化工作，不需要复杂推理
  - **Skills**: []
    - 无特殊技能需求

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3, 4, 5, 6)
  - **Blocks**: Tasks 2, 3, 14
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - 现有项目结构：根目录 package.json, dashboard/package.json

  **External References**:
  - Bun 官方文档：https://bun.sh/docs/typescript

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 项目初始化成功
    Tool: Bash
    Preconditions: 空目录
    Steps:
      1. 运行 `bun install`
      2. 运行 `bun test`
      3. 检查目录结构
    Expected Result: bun test 通过，目录结构符合设计
    Evidence: .omo/evidence/task-1-project-init.txt

  Scenario: TypeScript 编译成功
    Tool: Bash
    Preconditions: 项目已初始化
    Steps:
      1. 运行 `bun run tsc --noEmit`
    Expected Result: 无类型错误
    Evidence: .omo/evidence/task-1-typescript-check.txt
  ```

  **Commit**: YES
  - Message: `chore: project scaffolding + config`
  - Files: package.json, tsconfig.json, .eslintrc.json, .prettierrc, src/, tests/
  - Pre-commit: `bun test`

- [x] 2. SQLite schema + migrations

  **What to do**:
  - 创建 src/db/schema.ts
  - 实现迁移系统（版本号 + applied_at）
  - 创建 events 表（参考设计文档 §3.1）
  - 创建 projection_sessions 表（参考设计文档 §4.1）
  - 创建 projection_daily 表（参考设计文档 §4.2）
  - 创建 projection_tool_calls 表（参考设计文档 §4.3）
  - 创建 snapshots 表（参考设计文档 §5.1）
  - 配置 PRAGMA：journal_mode=WAL, synchronous=NORMAL
  - 编写 TDD 测试：表创建、迁移、PRAGMA 配置

  **Must NOT do**:
  - 不使用 ORM 迁移工具
  - 不创建过多索引（按需添加）

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: SQLite schema 是标准化工作，设计文档已定义表结构
  - **Skills**: []
    - 无特殊技能需求

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3, 4, 5, 6)
  - **Blocks**: Tasks 4, 5, 7, 8, 9, 10
  - **Blocked By**: Task 1

  **References**:

  **Pattern References**:
  - 设计文档 §3.1: events 表结构
  - 设计文档 §4.1: projection_sessions 表结构
  - 设计文档 §4.2: projection_daily 表结构
  - 设计文档 §4.3: projection_tool_calls 表结构
  - 设计文档 §5.1: snapshots 表结构

  **External References**:
  - SQLite PRAGMA 文档：https://www.sqlite.org/pragma.html
  - Bun SQLite 文档：https://bun.sh/docs/api/sqlite

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 所有表创建成功
    Tool: Bash
    Preconditions: 空数据库
    Steps:
      1. 运行迁移
      2. 查询 sqlite_master
    Expected Result: 5 张表存在（events, projection_sessions, projection_daily, projection_tool_calls, snapshots）
    Evidence: .omo/evidence/task-2-tables-created.txt

  Scenario: PRAGMA 配置正确
    Tool: Bash
    Preconditions: 数据库已创建
    Steps:
      1. 查询 PRAGMA journal_mode
      2. 查询 PRAGMA synchronous
    Expected Result: journal_mode=WAL, synchronous=NORMAL
    Evidence: .omo/evidence/task-2-pragma-config.txt

  Scenario: 迁移幂等性
    Tool: Bash
    Preconditions: 数据库已创建
    Steps:
      1. 运行迁移两次
      2. 检查 schema_migrations 表
    Expected Result: 迁移只执行一次
    Evidence: .omo/evidence/task-2-migration-idempotent.txt
  ```

  **Commit**: YES
  - Message: `feat(db): SQLite schema + migrations`
  - Files: src/db/schema.ts, src/db/migrations/
  - Pre-commit: `bun test`

- [x] 3. TypeScript type definitions

  **What to do**:
  - 创建 src/types/events.ts（30 种事件类型）
  - 创建 src/types/projections.ts（投影类型）
  - 创建 src/types/snapshots.ts（快照类型）
  - 创建 src/types/api.ts（API 请求/响应类型）
  - 创建 src/types/sse.ts（SSE 消息类型）
  - **JSON 字段类型化**：为所有 JSON 字段定义明确的 TypeScript 接口，包括：
    - `event_contents`: 根据 event_type 定义不同的接口（如 SessionCreatedContents, MessageUpdatedContents, ToolExecuteAfterContents 等），使用联合类型 + 判别属性
    - `model_usage`: ModelUsageMap 接口（包含 message_count, tokens: TokenStats, cost_usd）
    - `agent_usage`: AgentUsageMap 接口（包含 message_count, tokens: TokenStats, cost_usd）
    - `snapshot_data`: 根据 snapshot_type 定义不同的接口（如 SessionSnapshotData, DailySnapshotData），使用联合类型 + 判别属性
  - 实现类型守卫函数（如 `isSessionCreatedContents(data: unknown): data is SessionCreatedContents`）
  - 编写 TDD 测试：类型兼容性检查、JSON 序列化/反序列化验证、类型守卫验证

  **Must NOT do**:
  - 不使用 `any` 类型
  - 不使用 `JSON.parse() as T` 的类型断言（应使用类型守卫或 zod 验证）
  - 不创建过度复杂的泛型

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 类型定义是标准化工作，设计文档已定义数据结构
  - **Skills**: []
    - 无特殊技能需求

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 4, 5, 6)
  - **Blocks**: Tasks 4, 5, 7, 8, 9, 10, 11
  - **Blocked By**: Task 1

  **References**:

  **Pattern References**:
  - 设计文档 §3.3: event_contents 结构示例
  - 设计文档 §4.1: model_usage, agent_usage JSON 结构
  - 设计文档 §5.2: 快照 ID 格式
  - 设计文档 §6.3: SSE 事件格式
  - 设计文档 §7.3: 查询参数类型

  **External References**:
  - TypeScript 严格模式：https://www.typescriptlang.org/tsconfig#strict

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 类型编译成功
    Tool: Bash
    Preconditions: 类型文件已创建
    Steps:
      1. 运行 `bun run tsc --noEmit`
    Expected Result: 无类型错误
    Evidence: .omo/evidence/task-3-types-compile.txt

  Scenario: 事件类型覆盖完整
    Tool: Bash
    Preconditions: 类型文件已创建
    Steps:
      1. 检查 EventType 联合类型包含 30 种事件
    Expected Result: 30 种事件类型全部定义
    Evidence: .omo/evidence/task-3-event-types.txt
  ```

  **Commit**: YES
  - Message: `feat(types): TypeScript type definitions`
  - Files: src/types/
  - Pre-commit: `bun test`

- [x] 4. Event Store implementation

  **What to do**:
  - 创建 src/store/event.ts
  - 实现 insertEvent() 函数（幂等写入，INSERT OR IGNORE）
  - 实现 getEvents() 函数（按 session_id, event_type, 时间范围查询）
  - 实现 getEventById() 函数
  - 实现 countEvents() 函数
  - 使用 prepared statements 优化性能
  - 使用 db.transaction() 包装批量写入
  - 编写 TDD 测试：幂等写入、查询、性能

  **Must NOT do**:
  - 不创建 Repository/Aggregate 模式
  - 不使用 ORM
  - 不在单次写入中处理多个事件（除非批量）

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Event Store 是核心组件，需要仔细处理幂等性和性能
  - **Skills**: []
    - 无特殊技能需求

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 3, 5, 6)
  - **Blocks**: Tasks 7, 8, 9, 11, 12
  - **Blocked By**: Tasks 2, 3

  **References**:

  **Pattern References**:
  - 设计文档 §3.1: events 表结构
  - 设计文档 §3.2: 设计原则（不可变性、幂等性、完整性、可追溯）

  **External References**:
  - Bun SQLite prepared statements：https://bun.sh/docs/api/sqlite#prepared-statements
  - SQLite INSERT OR IGNORE：https://www.sqlite.org/lang_insert.html

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 幂等写入
    Tool: Bash
    Preconditions: Event Store 已实现
    Steps:
      1. 插入事件 A
      2. 再次插入事件 A（相同 event_id）
      3. 查询事件数量
    Expected Result: 事件数量为 1
    Evidence: .omo/evidence/task-4-idempotent-write.txt

  Scenario: 批量写入性能
    Tool: Bash
    Preconditions: Event Store 已实现
    Steps:
      1. 批量插入 1000 条事件
      2. 测量执行时间
    Expected Result: 执行时间 < 500ms
    Evidence: .omo/evidence/task-4-batch-write-performance.txt

  Scenario: 查询功能
    Tool: Bash
    Preconditions: Event Store 已实现
    Steps:
      1. 插入 10 条不同 session_id 的事件
      2. 按 session_id 查询
      3. 按 event_type 查询
      4. 按时间范围查询
    Expected Result: 查询结果正确
    Evidence: .omo/evidence/task-4-query-functions.txt
  ```

  **Commit**: YES
  - Message: `feat(store): Event Store implementation`
  - Files: src/store/event.ts
  - Pre-commit: `bun test`

- [x] 5. Projection Engine foundation

  **What to do**:
  - 创建 src/projection/engine.ts
  - 实现 ProjectionEngine 类
  - 实现 processEvent() 方法（解析 event_type，路由到对应投影处理器）
  - 实现事务性更新（db.transaction()）
  - 实现幂等性检查（避免重复处理）
  - 创建 src/projection/handlers/ 目录
  - 编写 TDD 测试：事件路由、事务性、幂等性

  **Must NOT do**:
  - 不创建过度复杂的抽象层
  - 不在投影引擎中实现具体投影逻辑（由 handlers 实现）

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 投影引擎是核心组件，需要仔细处理事务和幂等性
  - **Skills**: []
    - 无特殊技能需求

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 3, 4, 6)
  - **Blocks**: Tasks 7, 8, 9, 10, 11
  - **Blocked By**: Tasks 2, 3

  **References**:

  **Pattern References**:
  - 设计文档 §4.4: 投影引擎工作流程
  - 设计文档 §4.5: 投影重建机制

  **External References**:
  - Bun SQLite transactions：https://bun.sh/docs/api/sqlite#transactions

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 事件路由正确
    Tool: Bash
    Preconditions: 投影引擎已实现
    Steps:
      1. 发送 session.created 事件
      2. 发送 message.updated 事件
      3. 检查路由日志
    Expected Result: 事件被路由到正确的 handler
    Evidence: .omo/evidence/task-5-event-routing.txt

  Scenario: 事务性更新
    Tool: Bash
    Preconditions: 投影引擎已实现
    Steps:
      1. 发送一个会触发多表更新的事件
      2. 模拟中间失败
      3. 检查数据库状态
    Expected Result: 所有表要么全部更新，要么全部不更新
    Evidence: .omo/evidence/task-5-transactional-update.txt

  Scenario: 幂等性检查
    Tool: Bash
    Preconditions: 投影引擎已实现
    Steps:
      1. 处理事件 A
      2. 再次处理事件 A
      3. 检查投影状态
    Expected Result: 投影状态不变
    Evidence: .omo/evidence/task-5-idempotency-check.txt
  ```

  **Commit**: YES
  - Message: `feat(projection): Projection Engine foundation`
  - Files: src/projection/engine.ts, src/projection/handlers/
  - Pre-commit: `bun test`

- [x] 6. SSE infrastructure

  **What to do**:
  - 创建 src/sse/broadcaster.ts
  - 实现 SSEBroadcaster 类
  - 实现 broadcast() 方法（广播消息到所有连接）
  - 实现 addClient() / removeClient() 方法
  - 实现 keepalive 机制（15 秒间隔）
  - 配置 Bun.serve timeout（0，禁用空闲超时）
  - 编写 TDD 测试：广播、连接管理、keepalive

  **Must NOT do**:
  - 不在 SSE 中推送完整数据（只推送通知）
  - 不实现复杂的消息队列

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: SSE 基础设施是标准化工作
  - **Skills**: []
    - 无特殊技能需求

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 3, 4, 5)
  - **Blocks**: Task 13
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - 设计文档 §6.1: 实时更新架构概览
  - 设计文档 §6.2: 双通道设计

  **External References**:
  - Bun.serve timeout：https://bun.sh/docs/api/http#bun-serve
  - SSE 规范：https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 广播功能
    Tool: Bash
    Preconditions: SSE 基础设施已实现
    Steps:
      1. 创建 3 个客户端连接
      2. 广播消息
      3. 检查所有客户端是否收到
    Expected Result: 所有客户端收到消息
    Evidence: .omo/evidence/task-6-broadcast.txt

  Scenario: 连接管理
    Tool: Bash
    Preconditions: SSE 基础设施已实现
    Steps:
      1. 添加客户端
      2. 移除客户端
      3. 广播消息
    Expected Result: 已移除的客户端不收到消息
    Evidence: .omo/evidence/task-6-connection-management.txt

  Scenario: Keepalive 机制
    Tool: Bash
    Preconditions: SSE 基础设施已实现
    Steps:
      1. 建立连接
      2. 等待 30 秒
      3. 检查是否收到 keepalive
    Expected Result: 收到 keepalive 消息
    Evidence: .omo/evidence/task-6-keepalive.txt
  ```

  **Commit**: YES
  - Message: `feat(sse): SSE infrastructure`
  - Files: src/sse/broadcaster.ts
  - Pre-commit: `bun test`

- [x] 7. projection_sessions implementation

  **What to do**:
  - 创建 src/projection/sessions.ts
  - 实现 SessionProjectionHandler 类
  - 处理 session.created 事件（创建会话记录）
  - 处理 session.deleted 事件（更新状态）
  - 处理 message.updated 事件（更新 token 统计）
  - 处理 tool 事件（更新工具统计）
  - 处理 file.edited 事件（更新文件统计）
  - 计算 primary_model 和 primary_agent
  - **JSON 字段类型化**：
    - 使用 `ModelUsageMap` 和 `AgentUsageMap` 接口（定义在 src/types/projections.ts）
    - 更新 JSON 字段时使用类型安全的函数（如 `updateModelUsage(current: ModelUsageMap, event: MessageEvent): ModelUsageMap`）
    - 避免直接 JSON.parse/stringify，使用类型守卫验证数据结构
  - 编写 TDD 测试：各种事件处理、JSON 更新、计算逻辑、类型安全验证

  **Must NOT do**:
  - 不在投影中存储原始事件（只存储聚合数据）
  - 不创建过多的数据库查询（使用 prepared statements）
  - 不使用 `JSON.parse() as ModelUsageMap` 的类型断言（应使用类型守卫）

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: projection_sessions 是最复杂的投影，需要处理多种事件类型和 JSON 更新
  - **Skills**: []
    - 无特殊技能需求

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 8, 9, 10, 11)
  - **Blocks**: Task 12
  - **Blocked By**: Tasks 4, 5

  **References**:

  **Pattern References**:
  - 设计文档 §4.1: projection_sessions 表结构
  - 设计文档 §4.1: model_usage JSON 结构
  - 设计文档 §4.1: agent_usage JSON 结构
  - 设计文档 §4.1: 字段来源映射

  **External References**:
  - SQLite JSON 函数：https://www.sqlite.org/json1.html

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: session.created 事件处理
    Tool: Bash
    Preconditions: 投影处理器已实现
    Steps:
      1. 发送 session.created 事件
      2. 查询 projection_sessions 表
    Expected Result: 会话记录已创建，字段正确
    Evidence: .omo/evidence/task-7-session-created.txt

  Scenario: message.updated 事件处理
    Tool: Bash
    Preconditions: 会话已创建
    Steps:
      1. 发送 message.updated 事件（role=assistant）
      2. 查询 projection_sessions 表
    Expected Result: token 统计已更新，model_usage 已更新
    Evidence: .omo/evidence/task-7-message-updated.txt

  Scenario: JSON 字段结构验证
    Tool: Bash
    Preconditions: 多个事件已处理
    Steps:
      1. 查询 projection_sessions 的 model_usage
      2. 验证 JSON 结构
    Expected Result: JSON 结构符合设计文档
    Evidence: .omo/evidence/task-7-json-structure.txt
  ```

  **Commit**: YES
  - Message: `feat(projection): projection_sessions`
  - Files: src/projection/sessions.ts
  - Pre-commit: `bun test`

- [x] 8. projection_daily implementation

  **What to do**:
  - 创建 src/projection/daily.ts
  - 实现 DailyProjectionHandler 类
  - 处理 message.updated 事件（更新消息统计）
  - 处理 tool 事件（更新工具统计）
  - 处理 file.edited 事件（更新文件统计）
  - 处理 error 事件（更新错误统计）
  - 按 date, project_path, model 聚合数据
  - **JSON 字段类型化**：
    - 使用 `AgentUsageMap` 接口（定义在 src/types/projections.ts）
    - 更新 agent_usage 时使用类型安全的函数
    - 避免直接 JSON.parse/stringify，使用类型守卫验证数据结构
  - 编写 TDD 测试：各种事件处理、聚合逻辑、类型安全验证

  **Must NOT do**:
  - 不在每次事件都更新 daily 聚合（使用批量更新）
  - 不存储原始事件（只存储聚合数据）
  - 不使用 `JSON.parse() as AgentUsageMap` 的类型断言（应使用类型守卫）

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: projection_daily 涉及复杂的聚合逻辑和跨天处理
  - **Skills**: []
    - 无特殊技能需求

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 7, 9, 10, 11)
  - **Blocks**: Task 12
  - **Blocked By**: Tasks 4, 5

  **References**:

  **Pattern References**:
  - 设计文档 §4.2: projection_daily 表结构
  - 设计文档 §4.2: 查询示例

  **External References**:
  - SQLite GROUP BY：https://www.sqlite.org/lang_select.html

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 日级聚合正确
    Tool: Bash
    Preconditions: 投影处理器已实现
    Steps:
      1. 发送同一天的多个事件
      2. 查询 projection_daily 表
    Expected Result: 聚合数据正确
    Evidence: .omo/evidence/task-8-daily-aggregation.txt

  Scenario: 跨天事件处理
    Tool: Bash
    Preconditions: 投影处理器已实现
    Steps:
      1. 发送不同天的事件
      2. 查询 projection_daily 表
    Expected Result: 每天的数据独立聚合
    Evidence: .omo/evidence/task-8-cross-day-events.txt

  Scenario: 多维度聚合
    Tool: Bash
    Preconditions: 多个项目和模型的事件
    Steps:
      1. 查询按 model 聚合
      2. 查询按 project 聚合
    Expected Result: 聚合结果正确
    Evidence: .omo/evidence/task-8-multi-dimension.txt
  ```

  **Commit**: YES
  - Message: `feat(projection): projection_daily`
  - Files: src/projection/daily.ts
  - Pre-commit: `bun test`

- [x] 9. projection_tool_calls implementation

  **What to do**:
  - 创建 src/projection/tool-calls.ts
  - 实现 ToolCallProjectionHandler 类
  - 处理 tool.started 事件（创建工具调用记录）
  - 处理 tool.completed 事件（更新状态和耗时）
  - 处理 tool.failed 事件（更新错误信息）
  - 更新 token 统计（如果可用）
  - 编写 TDD 测试：各种事件处理、状态更新

  **Must NOT do**:
  - 不存储完整的工具输出（只存储统计信息）

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 工具调用投影相对简单，但需要处理状态机
  - **Skills**: []
    - 无特殊技能需求

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 7, 8, 10, 11)
  - **Blocks**: Task 12
  - **Blocked By**: Tasks 4, 5

  **References**:

  **Pattern References**:
  - 设计文档 §4.3: projection_tool_calls 表结构

  **External References**:
  - 无

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 工具调用生命周期
    Tool: Bash
    Preconditions: 投影处理器已实现
    Steps:
      1. 发送 tool.started 事件
      2. 发送 tool.completed 事件
      3. 查询 projection_tool_calls 表
    Expected Result: 状态从 pending 变为 completed，耗时正确
    Evidence: .omo/evidence/task-9-tool-lifecycle.txt

  Scenario: 工具调用失败
    Tool: Bash
    Preconditions: 投影处理器已实现
    Steps:
      1. 发送 tool.started 事件
      2. 发送 tool.failed 事件
      3. 查询 projection_tool_calls 表
    Expected Result: 状态为 error，错误信息正确
    Evidence: .omo/evidence/task-9-tool-failure.txt
  ```

  **Commit**: YES
  - Message: `feat(projection): projection_tool_calls`
  - Files: src/projection/tool-calls.ts
  - Pre-commit: `bun test`

- [x] 10. Snapshot system foundation

  **What to do**:
  - 创建 src/snapshot/manager.ts
  - 实现 SnapshotManager 类
  - 实现 generateSessionSnapshot() 函数
  - 实现 generateDailySnapshot() 函数
  - 实现 getSnapshot() 函数
  - 实现 isSnapshotValid() 函数
  - 实现查询时补全逻辑
  - **JSON 字段类型化**：
    - 使用 `SessionSnapshotData` 和 `DailySnapshotData` 接口（定义在 src/types/snapshots.ts）
    - 生成快照时使用类型安全的函数（如 `buildSessionSnapshotData(projection: ProjectionSession): SessionSnapshotData`）
    - 读取快照时使用类型守卫验证数据结构
  - 编写 TDD 测试：快照生成、有效性检查、补全逻辑、类型安全验证

  **Must NOT do**:
  - 不实现 weekly/monthly 快照（只做 session + daily）
  - 不在快照中存储原始事件
  - 不使用 `JSON.parse() as SessionSnapshotData` 的类型断言（应使用类型守卫）

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 快照系统涉及状态管理和查询优化
  - **Skills**: []
    - 无特殊技能需求

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 7, 8, 9, 11)
  - **Blocks**: Task 22
  - **Blocked By**: Task 5

  **References**:

  **Pattern References**:
  - 设计文档 §5.1: snapshots 表结构
  - 设计文档 §5.2: 快照 ID 格式
  - 设计文档 §5.3: 触发策略
  - 设计文档 §5.4: 实现逻辑
  - 设计文档 §5.5: 查询时补全
  - 设计文档 §5.6: 快照有效性检查

  **External References**:
  - 无

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 会话快照生成
    Tool: Bash
    Preconditions: 快照管理器已实现
    Steps:
      1. 发送 session.deleted 事件
      2. 查询 snapshots 表
    Expected Result: 会话快照已生成，数据正确
    Evidence: .omo/evidence/task-10-session-snapshot.txt

  Scenario: 日级快照生成
    Tool: Bash
    Preconditions: 快照管理器已实现
    Steps:
      1. 发送跨天事件
      2. 查询 snapshots 表
    Expected Result: 前一天的快照已生成
    Evidence: .omo/evidence/task-10-daily-snapshot.txt

  Scenario: 查询时补全
    Tool: Bash
    Preconditions: 快照管理器已实现
    Steps:
      1. 查询一个没有快照的日期
      2. 检查是否自动生成快照
    Expected Result: 快照自动生成并返回
    Evidence: .omo/evidence/task-10-query-completion.txt
  ```

  **Commit**: YES
  - Message: `feat(snapshot): Snapshot system foundation`
  - Files: src/snapshot/manager.ts
  - Pre-commit: `bun test`

- [x] 11. API Layer foundation

  **What to do**:
  - 创建 src/api/router.ts
  - 实现 APIRouter 类
  - 实现路由注册机制
  - 实现请求解析（URL、查询参数）
  - 实现响应格式化（JSON）
  - 实现错误处理中间件
  - 实现 CORS 支持
  - 创建 src/api/handlers/ 目录
  - 编写 TDD 测试：路由注册、请求解析、错误处理

  **Must NOT do**:
  - 不引入 Express/Koa 等框架（使用 Bun.serve）
  - 不实现复杂的中间件系统

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: API 层是基础设施，需要处理路由和错误处理
  - **Skills**: []
    - 无特殊技能需求

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 7, 8, 9, 10)
  - **Blocks**: Tasks 12, 13
  - **Blocked By**: Tasks 4, 5

  **References**:

  **Pattern References**:
  - 设计文档 §7.1: API 端点列表
  - 设计文档 §7.2: 路由结构
  - 设计文档 §7.3: 查询参数类型

  **External References**:
  - Bun.serve 路由：https://bun.sh/docs/api/http#bun-serve

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 路由注册
    Tool: Bash
    Preconditions: API 层已实现
    Steps:
      1. 注册 GET /api/v1/stats/overview 路由
      2. 发送请求
    Expected Result: 路由正确匹配
    Evidence: .omo/evidence/task-11-route-registration.txt

  Scenario: 请求解析
    Tool: Bash
    Preconditions: API 层已实现
    Steps:
      1. 发送带查询参数的请求
      2. 检查解析结果
    Expected Result: 参数正确解析
    Evidence: .omo/evidence/task-11-request-parsing.txt

  Scenario: 错误处理
    Tool: Bash
    Preconditions: API 层已实现
    Steps:
      1. 发送无效请求
      2. 检查响应
    Expected Result: 返回 400 错误，JSON 格式
    Evidence: .omo/evidence/task-11-error-handling.txt
  ```

  **Commit**: YES
  - Message: `feat(api): API Layer foundation`
  - Files: src/api/router.ts, src/api/handlers/
  - Pre-commit: `bun test`

- [x] 12. Stats API endpoints

  **What to do**:
  - 创建 src/api/stats.ts
  - 实现 GET /api/v1/stats/overview（总览统计）
  - 实现 GET /api/v1/stats/trend（趋势数据）
  - 实现 GET /api/v1/stats/sessions（会话列表）
  - 实现 GET /api/v1/stats/sessions/:id（会话详情）
  - 实现 GET /api/v1/stats/tools（工具统计）
  - 实现 GET /api/v1/stats/models（模型对比）
  - 实现 GET /api/v1/stats/projects（项目对比）
  - 实现 GET /api/v1/stats/errors（错误统计）
  - 实现查询参数解析（timeRange, filters, groupBy, sortBy, limit, offset）
  - 编写 TDD 测试：每个端点的响应格式、查询参数、边界条件

  **Must NOT do**:
  - 不实现复杂的查询优化（使用简单的 SQL 查询）
  - 不实现缓存（后续优化）

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 8 个 API 端点，需要处理多种查询逻辑
  - **Skills**: []
    - 无特殊技能需求

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 13, 14, 15)
  - **Blocks**: Tasks 16, 17, 18, 19, 20, 21
  - **Blocked By**: Tasks 7, 8, 9, 11

  **References**:

  **Pattern References**:
  - 设计文档 §7.1: API 端点列表
  - 设计文档 §7.3: 查询参数类型
  - 设计文档 §7.4: 查询流程
  - 设计文档 §7.5: 查询示例

  **External References**:
  - 无

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: overview 端点
    Tool: Bash (curl)
    Preconditions: API 已启动，有数据
    Steps:
      1. curl http://localhost:11133/api/v1/stats/overview
      2. 检查响应格式
    Expected Result: 返回 JSON，包含 total_sessions, total_tokens, total_cost_usd 等字段
    Evidence: .omo/evidence/task-12-overview.txt

  Scenario: trend 端点
    Tool: Bash (curl)
    Preconditions: API 已启动，有数据
    Steps:
      1. curl http://localhost:11133/api/v1/stats/trend?start=2026-06-01&end=2026-06-04
      2. 检查响应格式
    Expected Result: 返回数组，每个元素包含 date, tokens, cost, messages
    Evidence: .omo/evidence/task-12-trend.txt

  Scenario: sessions 端点分页
    Tool: Bash (curl)
    Preconditions: API 已启动，有数据
    Steps:
      1. curl http://localhost:11133/api/v1/stats/sessions?limit=10&offset=0
      2. curl http://localhost:11133/api/v1/stats/sessions?limit=10&offset=10
    Expected Result: 返回不同页的数据
    Evidence: .omo/evidence/task-12-sessions-pagination.txt

  Scenario: 空数据处理
    Tool: Bash (curl)
    Preconditions: API 已启动，无数据
    Steps:
      1. curl http://localhost:11133/api/v1/stats/overview
    Expected Result: 返回有效 JSON，数值为 0
    Evidence: .omo/evidence/task-12-empty-data.txt
  ```

  **Commit**: YES
  - Message: `feat(api): Stats API endpoints`
  - Files: src/api/stats.ts
  - Pre-commit: `bun test`

- [x] 13. SSE endpoint + integration

  **What to do**:
  - 创建 src/api/stream.ts
  - 实现 GET /api/v1/events/stream（SSE 端点）
  - 集成 SSEBroadcaster
  - 实现 SSE 消息格式（参考设计文档 §6.3）
  - 实现 buildStatsUpdate() 函数
  - 实现事件类型到 SSE 类型的映射
  - 编写 TDD 测试：SSE 连接、消息格式、事件映射

  **Must NOT do**:
  - 不在 SSE 中推送完整数据（只推送通知）
  - 不实现复杂的消息队列

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: SSE 端点需要处理长连接和事件映射
  - **Skills**: []
    - 无特殊技能需求

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 12, 14, 15)
  - **Blocks**: Tasks 22, 25
  - **Blocked By**: Tasks 6, 11

  **References**:

  **Pattern References**:
  - 设计文档 §6.3: SSE 事件格式
  - 设计文档 §6.4: 前端集成
  - 设计文档 §6.5: SSE 端点
  - 设计文档 §6.6: 事件处理流程

  **External References**:
  - SSE 规范：https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: SSE 连接建立
    Tool: Bash (curl)
    Preconditions: API 已启动
    Steps:
      1. curl -N -H "Accept: text/event-stream" http://localhost:11133/api/v1/events/stream
      2. 等待 5 秒
    Expected Result: 收到 SSE 连接，有 keepalive 消息
    Evidence: .omo/evidence/task-13-sse-connection.txt

  Scenario: SSE 消息格式
    Tool: Bash (curl)
    Preconditions: SSE 连接已建立
    Steps:
      1. 触发一个事件
      2. 检查 SSE 消息
    Expected Result: 消息格式符合设计文档 §6.3
    Evidence: .omo/evidence/task-13-sse-message-format.txt

  Scenario: 事件类型映射
    Tool: Bash
    Preconditions: SSE 端点已实现
    Steps:
      1. 发送 session.created 事件
      2. 发送 message.updated 事件
      3. 检查 SSE 消息类型
    Expected Result: 类型映射正确
    Evidence: .omo/evidence/task-13-event-type-mapping.txt
  ```

  **Commit**: YES
  - Message: `feat(api): SSE endpoint + integration`
  - Files: src/api/stream.ts
  - Pre-commit: `bun test`

- [x] 14. Vue 3 project scaffolding

  **What to do**:
  - 创建 dashboard/ 目录
  - 初始化 Vue 3 + Vite + TypeScript 项目
  - 配置 Vue Router（6 个路由）
  - 创建基础布局组件（AppLayout.vue）
  - 创建导航栏组件（AppNav.vue）
  - 创建状态栏组件（AppStatusBar.vue）
  - 创建 6 个页面占位组件
  - 配置 TypeScript（tsconfig.json）
  - 配置 ESLint + Prettier
  - 编写 TDD 测试：路由导航、组件渲染

  **Must NOT do**:
  - 不引入 Pinia（使用现有的 composable store 模式）
  - 不引入 Tailwind（使用 CSS）
  - 不创建过度复杂的组件抽象

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Vue 3 项目脚手架是标准化工作
  - **Skills**: []
    - 无特殊技能需求

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 12, 13, 15)
  - **Blocks**: Tasks 15, 16, 17, 18, 19, 20, 21
  - **Blocked By**: Task 1

  **References**:

  **Pattern References**:
  - 设计文档 §11.1: 整体布局

  **External References**:
  - Vue 3：https://vuejs.org/
  - Vue Router：https://router.vuejs.org/
  - Vite：https://vitejs.dev/

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 开发服务器启动
    Tool: Bash
    Preconditions: 项目已初始化
    Steps:
      1. cd dashboard && bun run dev
      2. 等待服务器启动
    Expected Result: 开发服务器在 http://localhost:5173 启动
    Evidence: .omo/evidence/task-14-dev-server.txt

  Scenario: 路由导航
    Tool: Playwright
    Preconditions: 开发服务器已启动
    Steps:
      1. 访问 http://localhost:5173/
      2. 点击导航栏链接
      3. 检查 URL 变化
    Expected Result: 路由正确切换
    Evidence: .omo/evidence/task-14-routing.txt

  Scenario: 构建成功
    Tool: Bash
    Preconditions: 项目已初始化
    Steps:
      1. cd dashboard && bun run build
    Expected Result: 构建成功，无错误
    Evidence: .omo/evidence/task-14-build.txt
  ```

  **Commit**: YES
  - Message: `chore: Vue 3 project scaffolding`
  - Files: dashboard/
  - Pre-commit: `cd dashboard && bun run build`

- [x] 15. ECharts integration

  **What to do**:
  - 安装 ECharts 依赖（npm install echarts vue-echarts）
  - 创建 dashboard/src/charts/BaseChart.vue（基础图表组件）
  - 创建 dashboard/src/charts/LineChart.vue（折线图）
  - 创建 dashboard/src/charts/BarChart.vue（柱状图）
  - 创建 dashboard/src/charts/PieChart.vue（饼图）
  - 创建 dashboard/src/charts/HeatmapChart.vue（热力图）
  - 创建 dashboard/src/charts/ScatterChart.vue（散点图）
  - 实现响应式图表大小
  - 实现主题配置（深色/浅色）
  - 编写 TDD 测试：图表渲染、数据更新

  **Must NOT do**:
  - 不创建过度复杂的图表抽象
  - 不实现所有图表类型（只实现设计文档中需要的）

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: ECharts 集成是标准化工作，vue-echarts 提供了良好的 Vue 集成
  - **Skills**: []
    - 无特殊技能需求

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 12, 13, 14)
  - **Blocks**: Tasks 16, 17, 18, 19, 20, 21
  - **Blocked By**: Task 14

  **References**:

  **Pattern References**:
  - 设计文档 §11.2-11.7: 各页面图表设计

  **External References**:
  - ECharts：https://echarts.apache.org/
  - vue-echarts：https://github.com/ecomfe/vue-echarts

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 图表组件渲染
    Tool: Playwright
    Preconditions: ECharts 已集成
    Steps:
      1. 创建一个使用 BaseChart 的测试页面
      2. 访问该页面
      3. 检查图表是否渲染
    Expected Result: 图表正确渲染
    Evidence: .omo/evidence/task-15-chart-render.txt

  Scenario: 数据更新
    Tool: Playwright
    Preconditions: 图表已渲染
    Steps:
      1. 更新图表数据
      2. 检查图表是否更新
    Expected Result: 图表正确更新
    Evidence: .omo/evidence/task-15-data-update.txt

  Scenario: 响应式大小
    Tool: Playwright
    Preconditions: 图表已渲染
    Steps:
      1. 调整浏览器窗口大小
      2. 检查图表是否自适应
    Expected Result: 图表大小自适应
    Evidence: .omo/evidence/task-15-responsive.txt
  ```

  **Commit**: YES
  - Message: `feat(charts): ECharts integration`
  - Files: dashboard/src/charts/
  - Pre-commit: `cd dashboard && bun run build`

- [x] 16. Overview page

  **What to do**:
  - 创建 dashboard/src/views/Overview.vue
  - 实现指标卡组件（总会话、总 Token、总成本、工具调用、代码变更）
  - 实现使用趋势图（折线图，7天/30天/全部）
  - 实现模型成本分布（饼图）
  - 实现项目使用排行（柱状图，Top 5）
  - 实现工具调用 Top 5（水平柱状图）
  - 实现近期会话列表（最新 10 条）
  - 集成 API 调用（/api/v1/stats/overview）
  - 实现时间范围选择器
  - 编写 TDD 测试：组件渲染、API 集成

  **Must NOT do**:
  - 不实现复杂的动画效果
  - 不实现数据导出功能

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Overview 页面是 Dashboard 的核心页面，需要良好的视觉设计
  - **Skills**: []
    - 无特殊技能需求

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with Tasks 17, 18, 19, 20, 21)
  - **Blocks**: Tasks 22, 23, 24
  - **Blocked By**: Tasks 12, 14, 15

  **References**:

  **Pattern References**:
  - 设计文档 §11.2: Overview 页面设计

  **External References**:
  - 无

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 页面渲染
    Tool: Playwright
    Preconditions: 开发服务器已启动
    Steps:
      1. 访问 http://localhost:5173/
      2. 检查指标卡是否渲染
      3. 检查图表是否渲染
    Expected Result: 页面正确渲染，无错误
    Evidence: .omo/evidence/task-16-page-render.txt

  Scenario: API 集成
    Tool: Playwright
    Preconditions: API 已启动
    Steps:
      1. 访问 Overview 页面
      2. 检查网络请求
      3. 检查数据是否显示
    Expected Result: API 调用成功，数据正确显示
    Evidence: .omo/evidence/task-16-api-integration.txt

  Scenario: 时间范围选择
    Tool: Playwright
    Preconditions: 页面已渲染
    Steps:
      1. 选择不同的时间范围
      2. 检查图表是否更新
    Expected Result: 图表数据正确更新
    Evidence: .omo/evidence/task-16-time-range.txt
  ```

  **Commit**: YES
  - Message: `feat(ui): Overview page`
  - Files: dashboard/src/views/Overview.vue
  - Pre-commit: `cd dashboard && bun run build`

- [x] 17. Efficiency page

  **What to do**:
  - 创建 dashboard/src/views/Efficiency.vue
  - 实现效率指标卡（平均会话时长、每任务成本、Token 利用率、错误率）
  - 实现工作时段分布（热力图，X轴: 小时，Y轴: 星期）
  - 实现消息轮次效率（每轮对话平均 token 消耗）
  - 实现响应时间分布（P50/P90/P99）
  - 实现任务完成率（成功/失败/取消）
  - 实现代码产出效率（每千 token 产出代码行数）
  - 集成 API 调用（/api/v1/stats/overview + /api/v1/stats/trend）
  - 实现时间范围选择器
  - 编写 TDD 测试：组件渲染、API 集成

  **Must NOT do**:
  - 不实现实时数据更新（使用 API 查询）
  - 不实现数据导出功能

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Efficiency 页面包含复杂图表（热力图），需要良好的视觉设计
  - **Skills**: []
    - 无特殊技能需求

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with Tasks 16, 18, 19, 20, 21)
  - **Blocks**: Tasks 22, 23, 24
  - **Blocked By**: Tasks 12, 14, 15

  **References**:

  **Pattern References**:
  - 设计文档 §11.3: Efficiency 页面设计

  **External References**:
  - ECharts 热力图：https://echarts.apache.org/examples/en/editor.html?c=heatmap

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 页面渲染
    Tool: Playwright
    Preconditions: 开发服务器已启动
    Steps:
      1. 访问 http://localhost:5173/efficiency
      2. 检查指标卡是否渲染
      3. 检查热力图是否渲染
    Expected Result: 页面正确渲染，无错误
    Evidence: .omo/evidence/task-17-page-render.txt

  Scenario: 热力图交互
    Tool: Playwright
    Preconditions: 页面已渲染
    Steps:
      1. 悬停在热力图单元格上
      2. 检查 tooltip
    Expected Result: tooltip 显示正确数据
    Evidence: .omo/evidence/task-17-heatmap-interaction.txt

  Scenario: 时间范围选择
    Tool: Playwright
    Preconditions: 页面已渲染
    Steps:
      1. 选择不同的时间范围
      2. 检查图表是否更新
    Expected Result: 图表数据正确更新
    Evidence: .omo/evidence/task-17-time-range.txt
  ```

  **Commit**: YES
  - Message: `feat(ui): Efficiency page`
  - Files: dashboard/src/views/Efficiency.vue
  - Pre-commit: `cd dashboard && bun run build`

- [x] 18. Models page

  **What to do**:
  - 创建 dashboard/src/views/Models.vue
  - 实现模型对比表格（模型、会话数、Token、成本、平均时长、错误率）
  - 实现 Token 细分对比（堆叠柱状图，每个模型: input + output + reasoning）
  - 实现成本趋势（折线图，每个模型一条线）
  - 实现性价比分析（成本 vs 产出散点图）
  - 集成 API 调用（/api/v1/stats/models）
  - 实现时间范围选择器
  - 编写 TDD 测试：组件渲染、API 集成

  **Must NOT do**:
  - 不实现模型切换功能
  - 不实现数据导出功能

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Models 页面包含多种图表类型（堆叠柱状图、折线图、散点图），需要良好的视觉设计
  - **Skills**: []
    - 无特殊技能需求

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with Tasks 16, 17, 19, 20, 21)
  - **Blocks**: Tasks 22, 23, 24
  - **Blocked By**: Tasks 12, 14, 15

  **References**:

  **Pattern References**:
  - 设计文档 §11.4: Models 页面设计

  **External References**:
  - ECharts 堆叠柱状图：https://echarts.apache.org/examples/en/editor.html?c=bar-stack
  - ECharts 散点图：https://echarts.apache.org/examples/en/editor.html?c=scatter

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 页面渲染
    Tool: Playwright
    Preconditions: 开发服务器已启动
    Steps:
      1. 访问 http://localhost:5173/models
      2. 检查表格是否渲染
      3. 检查图表是否渲染
    Expected Result: 页面正确渲染，无错误
    Evidence: .omo/evidence/task-18-page-render.txt

  Scenario: 表格排序
    Tool: Playwright
    Preconditions: 页面已渲染
    Steps:
      1. 点击表格列标题
      2. 检查排序结果
    Expected Result: 表格正确排序
    Evidence: .omo/evidence/task-18-table-sort.txt

  Scenario: 时间范围选择
    Tool: Playwright
    Preconditions: 页面已渲染
    Steps:
      1. 选择不同的时间范围
      2. 检查图表是否更新
    Expected Result: 图表数据正确更新
    Evidence: .omo/evidence/task-18-time-range.txt
  ```

  **Commit**: YES
  - Message: `feat(ui): Models page`
  - Files: dashboard/src/views/Models.vue
  - Pre-commit: `cd dashboard && bun run build`

- [x] 19. Projects page

  **What to do**:
  - 创建 dashboard/src/views/Projects.vue
  - 实现项目列表表格（项目路径、会话数、Token、成本、最后活跃）
  - 实现项目活跃度趋势（折线图）
  - 实现模型使用分布（每个项目的模型偏好）
  - 实现工具使用分布（每个项目的工具偏好）
  - 集成 API 调用（/api/v1/stats/projects）
  - 实现时间范围选择器
  - 实现项目路径截断 + tooltip 显示完整路径
  - 编写 TDD 测试：组件渲染、API 集成

  **Must NOT do**:
  - 不实现项目切换功能
  - 不实现数据导出功能

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Projects 页面需要处理长路径显示和多种图表
  - **Skills**: []
    - 无特殊技能需求

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with Tasks 16, 17, 18, 20, 21)
  - **Blocks**: Tasks 22, 23, 24
  - **Blocked By**: Tasks 12, 14, 15

  **References**:

  **Pattern References**:
  - 设计文档 §11.5: Projects 页面设计

  **External References**:
  - 无

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 页面渲染
    Tool: Playwright
    Preconditions: 开发服务器已启动
    Steps:
      1. 访问 http://localhost:5173/projects
      2. 检查表格是否渲染
      3. 检查图表是否渲染
    Expected Result: 页面正确渲染，无错误
    Evidence: .omo/evidence/task-19-page-render.txt

  Scenario: 长路径处理
    Tool: Playwright
    Preconditions: 有长路径项目
    Steps:
      1. 查看项目列表
      2. 悬停在长路径上
      3. 检查 tooltip
    Expected Result: 路径被截断，tooltip 显示完整路径
    Evidence: .omo/evidence/task-19-long-path.txt

  Scenario: 时间范围选择
    Tool: Playwright
    Preconditions: 页面已渲染
    Steps:
      1. 选择不同的时间范围
      2. 检查图表是否更新
    Expected Result: 图表数据正确更新
    Evidence: .omo/evidence/task-19-time-range.txt
  ```

  **Commit**: YES
  - Message: `feat(ui): Projects page`
  - Files: dashboard/src/views/Projects.vue
  - Pre-commit: `cd dashboard && bun run build`

- [x] 20. Tools page

  **What to do**:
  - 创建 dashboard/src/views/Tools.vue
  - 实现工具使用排行表格（工具名称、调用次数、成功率、平均耗时、Token、成本）
  - 实现工具使用趋势（折线图）
  - 实现错误类型分布（饼图，按工具分）
  - 实现耗时分布（直方图）
  - 集成 API 调用（/api/v1/stats/tools）
  - 实现时间范围选择器
  - 编写 TDD 测试：组件渲染、API 集成

  **Must NOT do**:
  - 不实现工具切换功能
  - 不实现数据导出功能

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Tools 页面包含多种图表类型（折线图、饼图、直方图），需要良好的视觉设计
  - **Skills**: []
    - 无特殊技能需求

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with Tasks 16, 17, 18, 19, 21)
  - **Blocks**: Tasks 22, 23, 24
  - **Blocked By**: Tasks 12, 14, 15

  **References**:

  **Pattern References**:
  - 设计文档 §11.6: Tools 页面设计

  **External References**:
  - ECharts 直方图：https://echarts.apache.org/examples/en/editor.html?c=bar-histogram

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 页面渲染
    Tool: Playwright
    Preconditions: 开发服务器已启动
    Steps:
      1. 访问 http://localhost:5173/tools
      2. 检查表格是否渲染
      3. 检查图表是否渲染
    Expected Result: 页面正确渲染，无错误
    Evidence: .omo/evidence/task-20-page-render.txt

  Scenario: 表格排序
    Tool: Playwright
    Preconditions: 页面已渲染
    Steps:
      1. 点击表格列标题
      2. 检查排序结果
    Expected Result: 表格正确排序
    Evidence: .omo/evidence/task-20-table-sort.txt

  Scenario: 时间范围选择
    Tool: Playwright
    Preconditions: 页面已渲染
    Steps:
      1. 选择不同的时间范围
      2. 检查图表是否更新
    Expected Result: 图表数据正确更新
    Evidence: .omo/evidence/task-20-time-range.txt
  ```

  **Commit**: YES
  - Message: `feat(ui): Tools page`
  - Files: dashboard/src/views/Tools.vue
  - Pre-commit: `cd dashboard && bun run build`

- [x] 21. Sessions page

  **What to do**:
  - 创建 dashboard/src/views/Sessions.vue
  - 实现会话列表表格（会话ID、项目、模型、Token、成本、状态）
  - 实现搜索功能
  - 实现过滤器（状态、模型、项目、时间）
  - 实现分页
  - 实现会话详情面板（选中会话后显示）
  - 集成 API 调用（/api/v1/stats/sessions）
  - 实现会话 ID 截断 + tooltip
  - 编写 TDD 测试：组件渲染、API 集成、搜索、过滤、分页

  **Must NOT do**:
  - 不实现会话编辑功能
  - 不实现数据导出功能

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Sessions 页面包含复杂交互（搜索、过滤、分页、详情面板），需要良好的视觉设计
  - **Skills**: []
    - 无特殊技能需求

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with Tasks 16, 17, 18, 19, 20)
  - **Blocks**: Tasks 22, 23, 24
  - **Blocked By**: Tasks 12, 14, 15

  **References**:

  **Pattern References**:
  - 设计文档 §11.7: Sessions 页面设计

  **External References**:
  - 无

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 页面渲染
    Tool: Playwright
    Preconditions: 开发服务器已启动
    Steps:
      1. 访问 http://localhost:5173/sessions
      2. 检查表格是否渲染
    Expected Result: 页面正确渲染，无错误
    Evidence: .omo/evidence/task-21-page-render.txt

  Scenario: 搜索功能
    Tool: Playwright
    Preconditions: 页面已渲染，有数据
    Steps:
      1. 输入搜索关键词
      2. 检查表格更新
    Expected Result: 表格正确过滤
    Evidence: .omo/evidence/task-21-search.txt

  Scenario: 过滤功能
    Tool: Playwright
    Preconditions: 页面已渲染，有数据
    Steps:
      1. 选择状态过滤器
      2. 选择模型过滤器
      3. 检查表格更新
    Expected Result: 表格正确过滤
    Evidence: .omo/evidence/task-21-filter.txt

  Scenario: 分页功能
    Tool: Playwright
    Preconditions: 页面已渲染，有数据
    Steps:
      1. 点击下一页
      2. 检查表格更新
    Expected Result: 表格显示下一页数据
    Evidence: .omo/evidence/task-21-pagination.txt

  Scenario: 会话详情
    Tool: Playwright
    Preconditions: 页面已渲染，有数据
    Steps:
      1. 点击会话行
      2. 检查详情面板
    Expected Result: 详情面板显示会话信息
    Evidence: .omo/evidence/task-21-session-detail.txt
  ```

  **Commit**: YES
  - Message: `feat(ui): Sessions page`
  - Files: dashboard/src/views/Sessions.vue
  - Pre-commit: `cd dashboard && bun run build`

- [x] 22. Real-time update integration

  **What to do**:
  - 创建 dashboard/src/composables/useSSE.ts
  - 实现 SSE 连接管理
  - 实现自动重连机制（5 秒间隔）
  - 实现 SSE 消息解析
  - 实现增量更新逻辑（根据 SSE 类型更新不同区域）
  - 实现状态指示器（绿点/黄点/红点）
  - 实现最后同步时间显示
  - 集成到所有页面
  - 编写 TDD 测试：SSE 连接、重连、消息处理

  **Must NOT do**:
  - 不实现复杂的消息队列
  - 不在 SSE 中推送完整数据（只处理通知）

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: SSE 集成需要处理长连接、重连、状态管理
  - **Skills**: []
    - 无特殊技能需求

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 5 (with Tasks 23, 24, 25)
  - **Blocks**: Task 25
  - **Blocked By**: Tasks 13, 16-21

  **References**:

  **Pattern References**:
  - 设计文档 §6.4: 前端集成
  - 设计文档 §11.8: 实时更新 UI

  **External References**:
  - SSE 规范：https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: SSE 连接建立
    Tool: Playwright
    Preconditions: 开发服务器和 API 已启动
    Steps:
      1. 访问任意页面
      2. 检查 SSE 连接状态
    Expected Result: SSE 连接建立，状态指示器为绿点
    Evidence: .omo/evidence/task-22-sse-connection.txt

  Scenario: 自动重连
    Tool: Playwright
    Preconditions: SSE 连接已建立
    Steps:
      1. 断开 SSE 连接
      2. 等待 5 秒
      3. 检查是否自动重连
    Expected Result: 自动重连成功，状态指示器恢复绿点
    Evidence: .omo/evidence/task-22-auto-reconnect.txt

  Scenario: 增量更新
    Tool: Playwright
    Preconditions: SSE 连接已建立，页面已渲染
    Steps:
      1. 触发一个事件
      2. 检查页面是否更新
    Expected Result: 页面正确更新
    Evidence: .omo/evidence/task-22-incremental-update.txt
  ```

  **Commit**: YES
  - Message: `feat(ui): Real-time update integration`
  - Files: dashboard/src/composables/useSSE.ts
  - Pre-commit: `cd dashboard && bun run build`

- [x] 23. Responsive design

  **What to do**:
  - 创建 dashboard/src/assets/responsive.css
  - 实现断点系统（1280px, 768px）
  - 实现指标卡响应式布局（桌面: 5 列，平板: 2x2，手机: 单列）
  - 实现图表响应式大小
  - 实现表格响应式布局
  - 实现导航栏响应式（桌面: 水平，手机: 汉堡菜单）
  - 更新所有页面组件
  - 编写 TDD 测试：不同断点下的布局

  **Must NOT do**:
  - 不引入 Tailwind 或其他 CSS 框架
  - 不实现复杂的动画效果

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: 响应式设计需要处理多种布局和断点
  - **Skills**: []
    - 无特殊技能需求

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 5 (with Tasks 22, 24, 25)
  - **Blocks**: None
  - **Blocked By**: Tasks 16-21

  **References**:

  **Pattern References**:
  - 设计文档 §11.9: 响应式设计

  **External References**:
  - CSS 媒体查询：https://developer.mozilla.org/en-US/docs/Web/CSS/Media_Queries

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 桌面布局
    Tool: Playwright
    Preconditions: 开发服务器已启动
    Steps:
      1. 设置浏览器宽度为 1280px
      2. 访问 Overview 页面
      3. 检查指标卡布局
    Expected Result: 指标卡显示为 5 列
    Evidence: .omo/evidence/task-23-desktop-layout.txt

  Scenario: 平板布局
    Tool: Playwright
    Preconditions: 开发服务器已启动
    Steps:
      1. 设置浏览器宽度为 768px
      2. 访问 Overview 页面
      3. 检查指标卡布局
    Expected Result: 指标卡显示为 2x2 布局
    Evidence: .omo/evidence/task-23-tablet-layout.txt

  Scenario: 手机布局
    Tool: Playwright
    Preconditions: 开发服务器已启动
    Steps:
      1. 设置浏览器宽度为 375px
      2. 访问 Overview 页面
      3. 检查指标卡布局
    Expected Result: 指标卡显示为单列布局
    Evidence: .omo/evidence/task-23-mobile-layout.txt
  ```

  **Commit**: YES
  - Message: `feat(ui): Responsive design`
  - Files: dashboard/src/assets/responsive.css, dashboard/src/views/*.vue
  - Pre-commit: `cd dashboard && bun run build`

- [x] 24. Empty state + loading states

  **What to do**:
  - 创建 dashboard/src/components/EmptyState.vue
  - 创建 dashboard/src/components/LoadingState.vue
  - 实现空状态 UI（无数据时显示引导信息）
  - 实现加载状态 UI（API 请求时显示加载动画）
  - 实现错误状态 UI（API 请求失败时显示错误信息）
  - 更新所有页面组件
  - 编写 TDD 测试：空状态、加载状态、错误状态

  **Must NOT do**:
  - 不实现复杂的动画效果
  - 不实现重试机制（后续优化）

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: 状态组件需要良好的视觉设计
  - **Skills**: []
    - 无特殊技能需求

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 5 (with Tasks 22, 23, 25)
  - **Blocks**: None
  - **Blocked By**: Tasks 16-21

  **References**:

  **Pattern References**:
  - 设计文档 §11.8: 实时更新 UI（状态指示）

  **External References**:
  - 无

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 空状态显示
    Tool: Playwright
    Preconditions: 开发服务器已启动，无数据
    Steps:
      1. 访问 Overview 页面
      2. 检查是否显示空状态
    Expected Result: 显示引导信息，而非空白
    Evidence: .omo/evidence/task-24-empty-state.txt

  Scenario: 加载状态显示
    Tool: Playwright
    Preconditions: 开发服务器已启动
    Steps:
      1. 访问 Overview 页面
      2. 检查是否显示加载状态
    Expected Result: 显示加载动画
    Evidence: .omo/evidence/task-24-loading-state.txt

  Scenario: 错误状态显示
    Tool: Playwright
    Preconditions: API 不可用
    Steps:
      1. 访问 Overview 页面
      2. 检查是否显示错误状态
    Expected Result: 显示错误信息
    Evidence: .omo/evidence/task-24-error-state.txt
  ```

  **Commit**: YES
  - Message: `feat(ui): Empty state + loading states`
  - Files: dashboard/src/components/EmptyState.vue, dashboard/src/components/LoadingState.vue, dashboard/src/views/*.vue
  - Pre-commit: `cd dashboard && bun run build`

- [x] 25. SSE auto-reconnect + error handling

  **What to do**:
  - 更新 src/sse/broadcaster.ts
  - 实现连接超时处理
  - 实现客户端断开检测
  - 实现错误日志记录
  - 更新 dashboard/src/composables/useSSE.ts
  - 实现指数退避重连策略
  - 实现最大重连次数限制
  - 实现重连失败后的降级方案（轮询）
  - 编写 TDD 测试：超时处理、断开检测、重连策略

  **Must NOT do**:
  - 不实现复杂的消息队列
  - 不实现消息持久化

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: SSE 错误处理需要处理多种异常情况
  - **Skills**: []
    - 无特殊技能需求

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 5 (with Tasks 22, 23, 24)
  - **Blocks**: None
  - **Blocked By**: Tasks 13, 22

  **References**:

  **Pattern References**:
  - 设计文档 §6.2: 双通道设计

  **External References**:
  - 指数退避：https://en.wikipedia.org/wiki/Exponential_backoff

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 连接超时处理
    Tool: Bash
    Preconditions: SSE 基础设施已实现
    Steps:
      1. 建立连接
      2. 模拟长时间无响应
      3. 检查超时处理
    Expected Result: 连接正确超时，触发重连
    Evidence: .omo/evidence/task-25-timeout-handling.txt

  Scenario: 指数退避重连
    Tool: Playwright
    Preconditions: SSE 连接已断开
    Steps:
      1. 断开连接
      2. 观察重连间隔
    Expected Result: 重连间隔按指数增长
    Evidence: .omo/evidence/task-25-exponential-backoff.txt

  Scenario: 降级方案
    Tool: Playwright
    Preconditions: SSE 连接失败
    Steps:
      1. 模拟 SSE 连接失败
      2. 检查是否降级到轮询
    Expected Result: 自动降级到轮询模式
    Evidence: .omo/evidence/task-25-fallback.txt
  ```

  **Commit**: YES
  - Message: `feat(sse): SSE auto-reconnect + error handling`
  - Files: src/sse/broadcaster.ts, dashboard/src/composables/useSSE.ts
  - Pre-commit: `bun test && cd dashboard && bun run build`

---

## Final Verification Wave

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.

- [x] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, curl endpoint, run command). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .omo/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Code Quality Review** — `unspecified-high`
  Run `tsc --noEmit` + linter + `bun test`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names (data/result/item/temp).
  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [x] F3. **Real Manual QA** — `unspecified-high` (+ `playwright` skill if UI)
  Start from clean state. Execute EVERY QA scenario from EVERY task — follow exact steps, capture evidence. Test cross-task integration (features working together, not isolation). Test edge cases: empty state, invalid input, rapid actions. Save to `.omo/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [x] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff (git log/diff). Verify 1:1 — everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance. Detect cross-task contamination: Task N touching Task M's files. Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

| Task | Commit Message | Files | Pre-commit |
|------|---------------|-------|------------|
| 1 | `chore: project scaffolding + config` | package.json, tsconfig.json, vite.config.ts | bun test |
| 2 | `feat(db): SQLite schema + migrations` | src/db/schema.ts, src/db/migrations/ | bun test |
| 3 | `feat(types): TypeScript type definitions` | src/types/ | bun test |
| 4 | `feat(store): Event Store implementation` | src/store/event.ts | bun test |
| 5 | `feat(projection): Projection Engine foundation` | src/projection/engine.ts | bun test |
| 6 | `feat(sse): SSE infrastructure` | src/sse/ | bun test |
| 7 | `feat(projection): projection_sessions` | src/projection/sessions.ts | bun test |
| 8 | `feat(projection): projection_daily` | src/projection/daily.ts | bun test |
| 9 | `feat(projection): projection_tool_calls` | src/projection/tool-calls.ts | bun test |
| 10 | `feat(snapshot): Snapshot system foundation` | src/snapshot/ | bun test |
| 11 | `feat(api): API Layer foundation` | src/api/ | bun test |
| 12 | `feat(api): Stats API endpoints` | src/api/stats.ts | bun test |
| 13 | `feat(api): SSE endpoint + integration` | src/api/stream.ts | bun test |
| 14 | `chore: Vue 3 project scaffolding` | dashboard/ | bun test |
| 15 | `feat(charts): ECharts integration` | dashboard/src/charts/ | bun test |
| 16 | `feat(ui): Overview page` | dashboard/src/views/Overview.vue | bun test |
| 17 | `feat(ui): Efficiency page` | dashboard/src/views/Efficiency.vue | bun test |
| 18 | `feat(ui): Models page` | dashboard/src/views/Models.vue | bun test |
| 19 | `feat(ui): Projects page` | dashboard/src/views/Projects.vue | bun test |
| 20 | `feat(ui): Tools page` | dashboard/src/views/Tools.vue | bun test |
| 21 | `feat(ui): Sessions page` | dashboard/src/views/Sessions.vue | bun test |
| 22 | `feat(ui): Real-time update integration` | dashboard/src/composables/ | bun test |
| 23 | `feat(ui): Responsive design` | dashboard/src/assets/ | bun test |
| 24 | `feat(ui): Empty state + loading states` | dashboard/src/components/ | bun test |
| 25 | `feat(sse): SSE auto-reconnect + error handling` | src/sse/, dashboard/src/composables/ | bun test |

---

## Success Criteria

### Verification Commands
```bash
# Backend
bun test  # Expected: all tests pass
curl -s http://localhost:11133/api/v1/stats/overview | jq '.total_sessions'  # Expected: number
curl -s http://localhost:11133/api/v1/events/stream  # Expected: SSE stream

# Frontend
cd dashboard && bun run dev  # Expected: dev server starts
cd dashboard && bun run build  # Expected: build succeeds
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] All tests pass
- [ ] No TypeScript errors
- [ ] All pages render correctly
- [ ] SSE real-time updates work
- [ ] Responsive design works at 768px breakpoint
