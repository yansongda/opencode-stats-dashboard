# 本地安装指南

本指南帮助你从源码构建并运行 OpenCode Stats Dashboard。

---

## 先决条件

安装以下工具：

| 工具 | 最低版本 | 用途 |
|------|---------|------|
| Rust | 1.90.0 | 构建 sidecar 边车服务 |
| Bun | 最新版 | 构建 Vue 仪表板、运行插件 |
| Node.js | 18+ | Vite 构建依赖 |

验证安装：

```bash
rustc --version    # >= 1.90.0
bun --version      # 任意最新版
node --version     # >= 18
```

---

## 构建

运行构建脚本，一步完成仪表板和 sidecar 的编译：

```bash
./scripts/build.sh
```

该脚本依次执行：

1. `bun run build`，编译 Vue 仪表板为静态文件
2. 将 `dashboard/dist` 复制到 `sidecar/static`，嵌入 sidecar 二进制
3. `cargo build`，编译 Rust sidecar（产物位于 `sidecar/target/debug/sidecar-api`）

构建成功后，sidecar 二进制文件位于：

```
sidecar/target/debug/sidecar-api
```

---

## 安装（配置 OpenCode 插件）

在你的 OpenCode 配置文件中添加插件。编辑 `opencode.json` 或 `opencode.jsonc`：

```jsonc
{
  "plugin": [
    "oh-my-openagent@latest",
    "/path/to/opencode-stats-dashboard/plugin/src/index.ts"
  ]
}
```

将 `/path/to/opencode-stats-dashboard` 替换为本项目的实际路径。

如果已有其他插件，直接追加到数组中即可。插件激活后会自动启动 sidecar 进程，无需手动管理。

---

## 启动

正常启动 OpenCode：

```bash
opencode
```

插件会在激活时：

1. 启动 sidecar 边车进程
2. 等待 sidecar 就绪并完成健康检查
3. 在控制台打印仪表板 URL

启动后你会看到类似输出：

```
Dashboard: http://127.0.0.1:52341
Sidecar health: ok
```

---

## 访问仪表板

在浏览器中打开控制台输出的 URL（如 `http://127.0.0.1:52341`）。

仪表板包含以下页面：

- **Overview**，总览指标、趋势图、模型分布
- **Sessions**，会话审计表，支持过滤、排序、分页
- **Tool Calls**，工具调用详情
- **Exports**，数据导出（CSV/JSON）与清理
- **Validation**，系统健康和隐私合规检查

---

## 停止

关闭 OpenCode 时，插件自动发送 SIGTERM 信号停止 sidecar 进程。

如需手动停止 sidecar：

```bash
# 查找进程
ps aux | grep sidecar-api

# 发送终止信号
kill <PID>
```

---

## 隐私模型

本项目默认采用隐私优先设计。

### 默认行为

| 数据类型 | 默认策略 | 说明 |
|---------|---------|------|
| 完整消息内容 | 不持久化 | 不存储用户/助手的完整消息文本 |
| 工具输入（args） | 不持久化 | 不存储工具调用的完整参数 |
| 工具输出（output） | 不持久化 | 不存储工具执行的完整返回值 |
| 会话元数据 | 持久化 | 会话 ID、项目路径、模型、代币数、成本、时间戳 |
| 工具调用摘要 | 可选持久化 | 工具名、状态、开始/完成时间、简短摘要（非完整输出） |

### 设计原则

- **最小化采集**，只收集统计分析所需的元数据字段
- **无完整负载**，工具输入输出、消息正文等敏感内容默认不进入存储
- **本地存储**，所有数据存储在本地 SQLite 文件中，不上传到任何远程服务

### 可选配置

插件配置中 `persistFullPayloads` 字段默认为 `false`。设置为 `true` 可启用完整载荷持久化，但会增加存储占用和隐私暴露面。通常不建议开启。

---

## 安全说明

### 网络绑定

sidecar 仅绑定到 `127.0.0.1`（回环地址），不监听外部网络接口。配置模块内置安全检查：

```typescript
const SAFE_HOSTS = new Set(["127.0.0.1", "localhost"])

if (!SAFE_HOSTS.has(host)) {
  throw new Error("remote_bind_not_allowed")
}
```

任何尝试绑定非回环地址的操作会被直接拒绝。

### 无认证令牌

当前实现不包含认证令牌机制。这意味着：

- 本机上任何进程都可以访问 `http://127.0.0.1:PORT` 的 API
- 仪表板不需要登录或密钥即可查看数据

**风险已接受**：该设计适用于个人开发机的本地使用场景。如果你的机器有多个不受信任的用户或进程，需要注意这一限制。

### 安全边界

| 威胁 | 现状 | 缓解措施 |
|------|------|---------|
| 远程网络访问 | 已防护 | 仅绑定 127.0.0.1，配置层拒绝非回环地址 |
| 本机其他进程访问 | 未防护 | 无令牌认证，依赖操作系统的用户隔离 |
| 数据泄露 | 已防护 | 默认不持久化敏感载荷，数据仅存本地 SQLite |

---

## 已知限制

### 不支持历史会话恢复

仪表板 **不会恢复** 安装前已存在的会话数据。统计追踪从插件激活那一刻开始：

- 安装前的会话不会出现在仪表板中
- 删除的会话如果在安装前已被删除，无法审计
- 没有"导入历史记录"功能

这是有意的设计选择。插件通过监听实时事件来收集数据，而非扫描 OpenCode 的内部存储。

### 其他限制

- **单用户设计**，不支持多用户并发访问仪表板
- **无远程访问**，无法从其他设备查看仪表板（除非自行修改绑定地址，但不推荐）
- **受限审计模式**，如果 OpenCode 事件表面未暴露工具调用生命周期，仪表板会回退到仅显示会话级别统计

---

## 故障排除

### sidecar 启动失败

检查 sidecar 二进制是否已构建：

```bash
ls sidecar/target/debug/sidecar-api
```

如果不存在，运行 `./scripts/build.sh` 重新构建。

### 仪表板无法访问

1. 确认 sidecar 进程正在运行：`ps aux | grep sidecar-api`
2. 检查端口是否被占用：`lsof -i :52341`
3. 查看 sidecar 日志输出，确认没有错误信息

### 数据为空

仪表板显示的统计从插件激活开始收集。安装后需要产生一些 OpenCode 会话活动，数据才会出现。
