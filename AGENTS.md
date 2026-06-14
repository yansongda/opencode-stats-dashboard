# AGENTS.md — opencode-stats-engine

## 项目定位

OpenCode 的事件溯源统计引擎插件：监听 OpenCode 事件 → 写入本地 SQLite → 投影统计表 → 通过 Hono HTTP、Dashboard API 和 SSE 提供本地统计服务。项目是 Bun workspace monorepo，根 `package.json` 声明 `"workspaces": ["packages/*"]`。

## 必守约束

- **运行时只用 Bun**：命令使用 `bun`，不要用 `npm`/`pnpm`/`yarn`。
- **模块系统是 ESM**：使用 `import`，不要用 `require`。
- **代码检查/格式化用 Biome**：不要引入 ESLint/Prettier。
- **数据库用 `bun:sqlite`**：不要换成 better-sqlite3、drizzle 等。
- **HTTP 框架用 Hono**：不要换成 Express/Fastify。
- **类型安全**：禁止 `as any`、`@ts-ignore`；严格修类型。
- **隐私红线**：`packages/shared/src/types/events.ts` 的 `FORBIDDEN_METADATA_KEYS` 禁止进入元数据，尤其是 `tool_input`、`tool_output`、`message_body`、`raw_input`、`raw_output`。
- **时区边界**：存储、投影、SSE 保持 UTC；时区转换只发生在 Dashboard API 边界和前端展示层，`*_ms` 字段语义不可改变。

## 常用命令

```bash
# 测试 (bun:test, 不是 vitest/jest)
bun test
bun test packages/engine/tests/projection/engine.test.ts
bun test --test-name-pattern "routes"

# 类型检查
bun run typecheck

# Biome
bun run biome:check
bun run biome:fix
bun run biome:fix-unsafe

# 构建
bun run build              # bun run --cwd packages/plugin build
bun run build:dashboard    # bun run --cwd packages/dashboard build

# Dashboard 开发
bun run --cwd packages/dashboard dev
bun run --cwd packages/dashboard type-check
```

**CI 顺序**：`biome:check` → `typecheck` → `test` → `build:dashboard` → `build`。

## 包边界

```text
packages/
├── plugin/     # npm 发布入口：StatsPlugin、logger、HTTP 静态资源挂载
├── engine/     # 后端核心：API、DB、event converter、projection、SSE、leader、store
├── shared/     # 共享类型和工具：events/api/stream/projections types，event/projection utils
└── dashboard/  # Vue 3 + Vite + vue-router + ECharts 仪表盘
```

数据流：`packages/plugin/src/index.ts` 插件钩子 → `packages/engine/src/event/converter.ts` 的 `convertEvent()` → `EventStore` → `ProjectionEngine` → `SSEBroadcaster`。

## 路径别名

根 `tsconfig.json`：

| 别名 | 映射到 |
|------|--------|
| `@defs/*` | `packages/shared/src/types/*` |
| `@opencode-stats/shared` / `@opencode-stats/shared/*` | `packages/shared/src` / `packages/shared/src/*` |
| `@opencode-stats/engine` / `@opencode-stats/engine/*` | `packages/engine/src` / `packages/engine/src/*` |
| `@opencode-stats/plugin` / `@opencode-stats/plugin/*` | `packages/plugin/src` / `packages/plugin/src/*` |
| `@opencode-stats/dashboard` / `@opencode-stats/dashboard/*` | `packages/dashboard/src` / `packages/dashboard/src/*` |

Dashboard 本地 `packages/dashboard/tsconfig.json` 还定义：`@/*` → `src/*`，`@defs/*` → `../shared/src/types/*`，`@opencode-stats/shared` / `@opencode-stats/shared/*` → `../shared/src` / `../shared/src/*`。

## 修改入口速查

- 插件生命周期、静态文件服务、事件处理编排：`packages/plugin/src/index.ts`
- 文件日志器：`packages/plugin/src/logger.ts`
- Dashboard API：`packages/engine/src/api/dashboard/`
- SQLite schema 与迁移：`packages/engine/src/db/`
- SDK Event → StatsEvent 转换：`packages/engine/src/event/`
- 投影处理器：`packages/engine/src/projection/`
- leader/follower HTTP 所有权：`packages/engine/src/server/leader.ts`
- SSE：`packages/engine/src/sse/broadcaster.ts`
- EventStore：`packages/engine/src/store/event.ts`
- 共享类型/工具：`packages/shared/src/`
- Vue Dashboard：`packages/dashboard/src/`

## 测试与开发模式

- 测试运行器：`bun:test`（`import { describe, it, expect, mock } from "bun:test"`）。
- 测试目录：`packages/engine/tests/`、`packages/shared/tests/`，结构镜像各包 `src/`。
- 引擎测试辅助函数在 `packages/engine/tests/helpers/`。
- 内存数据库测试使用 `new Database(":memory:")` + `runMigrations(db)`。
- Biome 作用域是 `packages/*/src/**`，测试不检查；Vue 文件有未用变量/导入 override。

## 新增事件类型 checklist

1. 在 `packages/shared/src/types/events.ts` 更新 `StatsEvent` 联合类型。
2. 在 `packages/engine/src/event/converters/` 新增转换器，导出 `eventType` 和 `convert`。
3. 在 `packages/engine/src/event/converter.ts` 的 `REGISTERED` 中注册。
4. 如需投影，更新 `packages/engine/src/projection/` 对应 handler 的 `handles`。
5. 如需新列，新增 `packages/engine/src/db/migrations/` 迁移并更新 schema。
6. 在 `packages/engine/tests/event/` 添加转换器测试，必要时补投影/API 测试。

## 设计文档索引

详细说明不要堆在本文件，按需阅读：

- `docs/architecture.md`：核心架构、数据流、模块职责、扩展指南。
- `docs/event-table-mapping.md`：事件类型、转换器、表结构、投影写入矩阵。
- `docs/dashboard-page-metrics-api-mapping.md`：Dashboard REST/SSE API、字段契约、时区参数。
- `docs/multi-instance.md`：leader/follower、多实例并发、SQLite WAL 行为。
