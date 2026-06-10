# AGENTS.md — opencode-stats-engine

## 项目简介

OpenCode 的事件溯源统计引擎。收集插件事件 → 持久化到 SQLite → 通过处理器投影统计数据 → 通过 HTTP (Hono) + SSE 提供服务。独立的 Vue 3 仪表盘位于 `dashboard/` 目录。

## 运行时和工具链

- **运行时**: Bun（不是 Node.js）。所有命令使用 `bun`，不用 `npm`/`pnpm`/`yarn`。
- **模块系统**: ESM（`"type": "module"`）。使用 `import`，不要用 `require`。
- **代码检查/格式化**: Biome（不是 ESLint/Prettier）。配置文件: `biome.json`。
- **数据库**: `bun:sqlite`（原生 SQLite，不是 better-sqlite3 或 drizzle）。
- **HTTP 框架**: Hono（不是 Express/Fastify）。
- **仪表盘**: Vue 3 + Vite + ECharts（独立包，位于 `dashboard/`）。

## 常用命令

```bash
# 测试 (bun:test, 不是 vitest/jest)
bun test                                  # 运行所有测试
bun test tests/projection/engine.test.ts  # 运行单个文件
bun test --test-name-pattern "routes"     # 按名称过滤

# 类型检查
bun run typecheck                         # tsc --noEmit

# 代码检查/格式化 (Biome)
bun run biome:check                       # 仅检查
bun run biome:fix                         # 自动修复安全问题
bun run biome:fix-unsafe                  # 自动修复包括不安全的问题

# 仪表盘
bun run build:dashboard                   # 构建 dashboard/dist/
cd dashboard && bun run dev               # 开发服务器（代理 /api → :11133）
```

**CI 执行顺序**: `biome:check` → `typecheck` → `test`

## 路径别名 (tsconfig.json)

在导入中使用这些别名 — 它们指向 `src/` 的子目录：

| 别名 | 映射到 |
|------|--------|
| `@/*` | `src/*` |
| `@api/*` | `src/api/*` |
| `@event/*` | `src/event/*` |
| `@db/*` | `src/db/*` |
| `@projection/*` | `src/projection/*` |
| `@snapshot/*` | `src/snapshot/*` |
| `@sse/*` | `src/sse/*` |
| `@store/*` | `src/store/*` |
| `@defs/*` | `src/types/*` |

示例: `import { EventStore } from "@store/event"`

## 架构

```
src/
├── index.ts          # 插件入口 — StatsPlugin（默认导出）
├── api/
│   └── dashboard/    # Hono 路由（7 个 REST 端点 + SSE stream）
├── db/               # SQLite schema + 迁移（schema.ts, migrations/001_initial.ts）
├── event/            # 事件转换器（SDK Event → StatsEvent）
│   ├── converter.ts  # 注册表：映射 event.type → 转换函数
│   └── converters/   # 每种事件类型一个文件（session-created.ts 等）
├── projection/       # 投影处理器（事件 → 聚合统计表）
│   ├── engine.ts     # ProjectionEngine：在事务中将事件路由到处理器
│   ├── sessions.ts   # projection_sessions 处理器
│   ├── daily.ts      # projection_daily_model_usage 处理器（按日期+项目+模型）
│   └── tool-calls.ts # projection_tool_calls 处理器
├── snapshot/         # 快照管理器（状态序列化）
├── sse/              # SSE 广播器（实时推送到仪表盘）
├── store/            # EventStore（追加式事件持久化）
└── types/            # TypeScript 类型（events.ts, projections.ts, api.ts, sse.ts）
```

**数据流**: 插件钩子 → `event/converter.ts` → `store/event.ts`（持久化）→ `projection/engine.ts`（路由到处理器）→ `sse/broadcaster.ts`（推送更新）

## 事件类型（共 8 种）

`session.created`, `session.deleted`, `session.error`, `session.diff`, `message.updated`, `tool.completed`, `tool.failed`, `file.edited`

`src/event/converters/` 中的每个转换器导出 `eventType`（字符串）和 `convert`（函数）。新增事件类型需要：转换器文件 + 在 `converter.ts` 中注册 + 更新相关投影处理器的 `handles` 数组。

## 添加新事件类型

1. 在 `src/types/events.ts` 的 `StatsEvent` 联合类型中添加类型
2. 创建 `src/event/converters/my-event.ts`，包含 `eventType` + `convert`
3. 在 `src/event/converter.ts` 的 `REGISTERED` 数组中注册
4. 在相关投影处理器的 `handles` 数组中添加事件类型
5. 如需新列，更新投影 SQL（添加迁移）
6. 在 `tests/events/` 中添加测试

## 环境变量

| 变量 | 默认值 | 用途 |
|------|--------|------|
| `STATS_PORT` | `11133` | HTTP 服务器端口 |
| `STATS_DB_DIR` | `~/.local/share/opencode-stats-engine/` | SQLite 目录 |
| `STATS_DB_PATH` | `$STATS_DB_DIR/stats.db` | SQLite 文件路径 |

## 测试模式

- 测试运行器: `bun:test`（`import { describe, it, expect, mock } from "bun:test"`）
- 内存数据库: `new Database(":memory:")` + `runMigrations(db)` 用于隔离测试
- 测试结构镜像 `src/`（例如 `tests/projection/engine.test.ts` 测试 `src/projection/engine.ts`）
- Mock 函数: `mock(() => {})` 来自 bun:test（不是 vitest.fn 或 jest.fn）
- 无 fixtures 目录 — 测试通过辅助函数（如 `makeEvent()`）内联创建数据

## Biome 配置

- 格式化器: 空格（不是制表符）
- 代码检查器: 启用推荐规则
- 范围: 仅 `src/**`（测试不检查）
- 保存时自动组织导入

## 开发规范

- **禁止 `as any` 或 `@ts-ignore`** — 严格模式已开启，修复类型
- **幂等写入** — EventStore 使用 `INSERT OR IGNORE`，投影检查 `processedEvents` 集合
- **错误隔离** — `processEvent` 将每个阶段（存储 → 投影 → 广播）包装在 try/catch 中；一个阶段的失败不会阻塞其他阶段
- **预编译语句** — EventStore 在 `queryCache` Map 中缓存 SQL 语句
- **事务安全** — 投影处理器在 `db.transaction()` 内运行；失败 = 回滚
- **隐私保护** — `src/types/events.ts` 中的 `FORBIDDEN_METADATA_KEYS` 列出了绝不能出现在元数据中的字段（`tool_input`, `tool_output`, `message_body`, `raw_input`, `raw_output`）

## 仪表盘（独立包）

- 位置: `dashboard/`（独立的 `package.json`, `node_modules`, `bun.lock`）
- 框架: Vue 3 + Vite + vue-router + ECharts
- 开发: `cd dashboard && bun run dev`（代理 `/api` 到 `http://127.0.0.1:11133`）
- 构建输出: `dashboard/dist/`（由主应用作为静态文件提供）
- 类型检查: `cd dashboard && bun run type-check`

## 插件集成

这是一个 OpenCode 插件（`@opencode-ai/plugin`）。默认导出是 `StatsPlugin`，它：
1. 接收 `PluginInput`，包含 `client.app.log` 用于结构化日志
2. 返回 `Hooks` 对象，包含 `event`, `tool.execute.after`, `dispose`
3. 跨调用维护单例 `StatsPluginInstance`
4. 直接使用 `Bun.serve()`（不是 Hono 内置的 serve）

## 设计文档

详细规范位于 `docs/superpowers/specs/`。代码注释中的引用（如 "§3.1"）指向该文档的章节。
