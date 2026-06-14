# 多实例并发支持

> 本文档说明 opencode-stats-engine 在同机同用户下多进程并发运行时的行为与约束。

---

## 设计模型

所有 opencode 实例共享同一份 SQLite 数据库，默认路径:

```
~/.local/share/opencode-stats-engine/stats.db
```

核心设计决策:

- **不引入 `instance_id` 维度** —— 所有实例写入同一份数据，dashboard 显示跨实例的合计统计
- **不做每实例隔离** —— 用户不应为不同 opencode 进程设置不同的 `STATS_DB_PATH`，这不被支持也不被推荐
- **零迁移成本** —— 单实例用户的现有 `stats.db` 直接可用，无需 dump/restore

事件写入路径对 leader 和 follower 完全对称: 无论哪个进程接收到 SDK 事件，都会正常写入 events 表并触发投影更新。

---

## 端口策略: Leader-only

多个实例竞争绑定 `STATS_PORT`（默认 11133）。Leader/follower 端口所有权管理实现位于 `packages/engine/src/server/leader.ts`：

- **Leader**: 首个成功绑定端口的实例，对外提供 Dashboard 和 SSE 服务
- **Follower**: 绑定失败的实例，静默进入后台模式，**不启动 HTTP 服务器**，但继续正常写入 DB

```bash
# 查看当前 leader 进程
lsof -i:11133 | grep LISTEN
```

初始化和运行时日志中会明确标注角色:

```
# Leader 实例
[stats-engine] role=leader port=11133
[stats-engine] initHttp initialized role=leader

# Follower 实例
[stats-engine] role=follower port=11133 (address in use, running without HTTP)
[stats-engine] initHttp initialized role=follower
```

关闭时同样输出角色:

```
[stats-engine] shutdown role=leader
```

follower 进程的所有事件处理、投影更新均正常工作，只是不对外提供 HTTP 服务。

---

## Leader 切换行为

当 leader 进程退出后，follower 会自动尝试接管端口:

1. follower 每 **5 秒**轮询一次，尝试绑定 `STATS_PORT`
2. 绑定成功则切换为 leader，日志输出 `took over`
3. 从 leader 退出到新 leader 就绪，**最长约 10 秒**（5 秒轮询间隔 + 进程退出缓冲）

切换过程中 dashboard 短暂不可用是预期行为。前端无需特殊处理，刷新页面即可恢复。

多个 follower 同时竞争时，只有绑定成功的一个成为新 leader，其余继续等待。这由操作系统端口绑定的原子性保证。

---

## 已知局限

### SSE 实时推送仅来自当前 leader

SSE 广播是进程内行为。只有当前 leader 进程接收到的事件会通过 SSE 实时推送到 dashboard。

### follower 写入的事件需要刷新才能看到

非 leader 进程写入的事件会正确持久化到 SQLite，但不会触发跨进程 SSE 推送。用户需要刷新 dashboard 页面（或等待下一次定时查询）才能看到这些数据。

**不要依赖跨进程 SSE 广播** —— 这不在当前设计范围内。

### 仅限同机同用户

多实例支持的范围是同一台机器、同一用户下的多个 opencode CLI 进程。不支持跨机器集群部署。

---

## 环境变量

以下环境变量的行为在多实例模式下**完全不变**:

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `STATS_PORT` | `11133` | HTTP 服务端口，leader 绑定 |
| `STATS_DB_DIR` | `~/.local/share/opencode-stats-engine/` | SQLite 数据库目录 |
| `STATS_DB_PATH` | `$STATS_DB_DIR/stats.db` | SQLite 数据库文件路径 |

所有实例应使用相同的 `STATS_DB_PATH`（默认值即可）。为不同实例设置不同数据库路径不是支持的隔离方式。

---

## 并发安全机制

多实例并发运行时，以下机制保证数据正确性（相关实现位于 `packages/engine/src/store/event.ts`、`packages/engine/src/db/schema.ts` 和 `packages/engine/src/db/migrations/`）:

- **SQLite WAL 模式** —— 允许多进程并发读 + 单写
- **busy_timeout = 5000ms** —— 写入冲突时内部排队等待，避免立即 SQLITE_BUSY
- **迁移并发安全** —— 多进程同时启动时，迁移通过 `INSERT OR IGNORE` 避免 PRIMARY KEY 冲突
- **幂等写入** —— events 表使用 `INSERT OR IGNORE`，messages 表使用 `ON CONFLICT DO UPDATE`
