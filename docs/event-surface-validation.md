# OpenCode 事件表面验证报告

**验证日期**: 2026-06-03
**验证目标**: 确认 OpenCode 插件事件钩子是否支持工具调用生命周期事件
**验证结果**: ✅ PASS - 工具调用生命周期事件完全可用

---

## 1. 验证摘要

| 事件类型 | 状态 | 证据来源 | 备注 |
|---------|------|---------|------|
| `session.deleted` | ✅ PASS | SDK 类型定义 | 完整 payload 结构可用 |
| `tool.execute.before` | ✅ PASS | 插件钩子接口 | 工具执行前触发 |
| `tool.execute.after` | ✅ PASS | 插件钩子接口 | 工具执行后触发 |
| `session.next.tool.*` | ✅ PASS | 核心事件系统 | 细粒度工具生命周期事件 |

---

## 2. session.deleted 事件验证

### 2.1 事件定义

**来源**: `packages/sdk/js/src/gen/types.gen.ts`

```typescript
export type EventSessionDeleted = {
  type: "session.deleted"
  properties: {
    info: Session
  }
}
```

### 2.2 Session 结构

```typescript
export type Session = {
  id: string                    // 会话 ID (格式: ses_*)
  projectID: string             // 项目 ID
  directory: string             // 工作目录
  parentID?: string             // 父会话 ID（可选）
  summary?: {                   // 会话摘要（可选）
    additions: number           // 新增行数
    deletions: number           // 删除行数
    files: number               // 修改文件数
    diffs?: Array<FileDiff>     // 差异详情
  }
  share?: {                     // 分享信息（可选）
    url: string                 // 分享 URL
  }
  title: string                 // 会话标题
  version: string               // 版本号
  time: {
    created: number             // 创建时间戳
    updated: number             // 更新时间戳
    compacting?: number         // 压缩时间戳（可选）
  }
  revert?: {                    // 回滚信息（可选）
    messageID: string
    partID?: string
    snapshot?: string
    diff?: string
  }
}
```

### 2.3 示例 Payload

```json
{
  "type": "session.deleted",
  "properties": {
    "info": {
      "id": "ses_abc123",
      "projectID": "proj_xyz789",
      "directory": "/Users/user/project",
      "title": "实现用户认证功能",
      "version": "1.0.0",
      "time": {
        "created": 1717400000000,
        "updated": 1717400100000
      },
      "summary": {
        "additions": 150,
        "deletions": 30,
        "files": 5
      }
    }
  }
}
```

---

## 3. 工具调用生命周期事件验证

### 3.1 插件钩子事件（Plugin Hooks）

**来源**: `packages/plugin/src/index.ts`

#### tool.execute.before

```typescript
"tool.execute.before"?: (
  input: { 
    tool: string        // 工具名称（如 "bash", "read", "write"）
    sessionID: string   // 会话 ID
    callID: string      // 调用 ID
  },
  output: { 
    args: any           // 工具参数（可修改）
  },
) => Promise<void>
```

**触发时机**: 工具执行前
**用途**: 
- 拦截和修改工具参数
- 权限检查
- 日志记录

#### tool.execute.after

```typescript
"tool.execute.after"?: (
  input: { 
    tool: string        // 工具名称
    sessionID: string   // 会话 ID
    callID: string      // 调用 ID
    args: any           // 工具参数
  },
  output: {
    title: string       // 工具标题
    output: string      // 工具输出
    metadata: any       // 元数据
  },
) => Promise<void>
```

**触发时机**: 工具执行后
**用途**:
- 记录工具执行结果
- 后处理
- 统计分析

### 3.2 核心会话事件（Session Events）

**来源**: `packages/core/src/session/event.ts`

OpenCode 提供了更细粒度的工具生命周期事件：

#### 工具输入阶段

| 事件类型 | 描述 | Payload |
|---------|------|---------|
| `session.next.tool.input.started` | 工具输入开始 | `{ callID, name }` |
| `session.next.tool.input.delta` | 工具输入增量 | `{ callID, delta }` |
| `session.next.tool.input.ended` | 工具输入结束 | `{ callID, text }` |

#### 工具执行阶段

| 事件类型 | 描述 | Payload |
|---------|------|---------|
| `session.next.tool.called` | 工具被调用 | `{ callID, tool, input, provider }` |
| `session.next.tool.progress` | 工具进度 | `{ callID, structured, content }` |
| `session.next.tool.success` | 工具成功 | `{ callID, structured, content, provider }` |
| `session.next.tool.failed` | 工具失败 | `{ callID, error, provider }` |

### 3.3 工具状态类型

**来源**: `packages/sdk/js/src/gen/types.gen.ts`

```typescript
export type ToolState = 
  | ToolStatePending     // 等待中
  | ToolStateRunning     // 运行中
  | ToolStateCompleted   // 已完成
  | ToolStateError       // 出错

export type ToolStatePending = {
  status: "pending"
  input: { [key: string]: unknown }
  raw: string
}

export type ToolStateRunning = {
  status: "running"
  input: { [key: string]: unknown }
  title?: string
  metadata?: { [key: string]: unknown }
  time: { start: number }
}

export type ToolStateCompleted = {
  status: "completed"
  input: { [key: string]: unknown }
  output: string
  title: string
  metadata: { [key: string]: unknown }
  time: { start: number; end: number; compacted?: number }
  attachments?: Array<FilePart>
}

export type ToolStateError = {
  status: "error"
  input: { [key: string]: unknown }
  error: string
  metadata?: { [key: string]: unknown }
  time: { start: number; end: number }
}
```

---

## 4. 完整事件列表

### 4.1 会话事件

| 事件类型 | 描述 | 可用性 |
|---------|------|--------|
| `session.created` | 会话创建 | ✅ |
| `session.updated` | 会话更新 | ✅ |
| `session.deleted` | 会话删除 | ✅ |
| `session.compacted` | 会话压缩 | ✅ |
| `session.diff` | 会话差异 | ✅ |
| `session.error` | 会话错误 | ✅ |
| `session.idle` | 会话空闲 | ✅ |
| `session.status` | 会话状态 | ✅ |

### 4.2 消息事件

| 事件类型 | 描述 | 可用性 |
|---------|------|--------|
| `message.updated` | 消息更新 | ✅ |
| `message.removed` | 消息删除 | ✅ |
| `message.part.updated` | 消息部分更新 | ✅ |
| `message.part.removed` | 消息部分删除 | ✅ |

### 4.3 工具事件

| 事件类型 | 描述 | 可用性 |
|---------|------|--------|
| `tool.execute.before` | 工具执行前（钩子） | ✅ |
| `tool.execute.after` | 工具执行后（钩子） | ✅ |
| `session.next.tool.input.started` | 工具输入开始 | ✅ |
| `session.next.tool.input.delta` | 工具输入增量 | ✅ |
| `session.next.tool.input.ended` | 工具输入结束 | ✅ |
| `session.next.tool.called` | 工具被调用 | ✅ |
| `session.next.tool.progress` | 工具进度 | ✅ |
| `session.next.tool.success` | 工具成功 | ✅ |
| `session.next.tool.failed` | 工具失败 | ✅ |

### 4.4 其他事件

| 事件类型 | 描述 | 可用性 |
|---------|------|--------|
| `command.executed` | 命令执行 | ✅ |
| `file.edited` | 文件编辑 | ✅ |
| `file.watcher.updated` | 文件监视器更新 | ✅ |
| `permission.updated` | 权限更新 | ✅ |
| `permission.replied` | 权限回复 | ✅ |
| `todo.updated` | 待办事项更新 | ✅ |
| `server.connected` | 服务器连接 | ✅ |

---

## 5. 实现建议

### 5.1 推荐方案：使用插件钩子

```typescript
// .opencode/plugins/stats-collector.ts
export const StatsCollector = async ({ client }) => {
  return {
    // 工具执行前
    "tool.execute.before": async (input, output) => {
      console.log(`[STATS] Tool started: ${input.tool} (${input.callID})`)
      // 记录开始时间
    },
    
    // 工具执行后
    "tool.execute.after": async (input, output) => {
      console.log(`[STATS] Tool completed: ${input.tool} (${input.callID})`)
      console.log(`[STATS] Output: ${output.title}`)
      // 记录完成时间和输出
    },
    
    // 会话事件
    event: async ({ event }) => {
      if (event.type === "session.deleted") {
        console.log(`[STATS] Session deleted: ${event.properties.info.id}`)
        // 清理会话统计数据
      }
    }
  }
}
```

### 5.2 备选方案：使用 SDK 事件流

```typescript
import { createOpencodeClient } from "@opencode-ai/sdk"

const client = createOpencodeClient()

// 订阅全局事件流
const events = await client.event.subscribe()

for await (const event of events) {
  if (event.type === "session.deleted") {
    // 处理会话删除
  }
  
  if (event.type === "message.part.updated") {
    const part = event.properties.part
    if (part.type === "tool") {
      // 处理工具状态变化
      console.log(`Tool ${part.tool}: ${part.state.status}`)
    }
  }
}
```

---

## 6. 结论

### ✅ 验证通过

1. **session.deleted 事件**: 完整可用，包含完整的 Session 信息
2. **工具调用生命周期事件**: 完整可用，提供两个层级的事件：
   - 插件钩子：`tool.execute.before` / `tool.execute.after`
   - 核心事件：`session.next.tool.*` 系列事件
3. **工具状态追踪**: 完整可用，支持 pending → running → completed/error 状态机

### 📊 可行性评估

| 需求 | 可行性 | 说明 |
|------|--------|------|
| 会话级审计 | ✅ 完全可行 | 使用 `session.*` 事件 |
| 工具调用追踪 | ✅ 完全可行 | 使用 `tool.execute.*` 钩子 |
| 实时状态监控 | ✅ 完全可行 | 使用 `session.next.tool.*` 事件 |
| 历史数据回放 | ✅ 完全可行 | 事件系统支持持久化和回放 |

### 🎯 建议实现路径

1. **Phase 1**: 使用插件钩子收集基础统计数据
2. **Phase 2**: 使用核心事件实现细粒度追踪
3. **Phase 3**: 使用 SDK 事件流实现实时仪表板

---

## 7. 参考资料

- [OpenCode 插件文档](https://opencode.ai/docs/zh-cn/plugins/)
- [OpenCode SDK 文档](https://opencode.ai/docs/sdk)
- [GitHub 源码](https://github.com/anomalyco/opencode)

---

**验证人**: OpenCode Stats Dashboard Team
**验证工具**: WebFetch, 源码分析
**置信度**: 高（基于官方文档和源码）
