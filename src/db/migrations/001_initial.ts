/**
 * 迁移脚本 001：初始模式 — 创建 4 个核心表
 *
 * 数据库首次迁移，建立事件溯源统计引擎的基础表结构。
 *
 * 创建的表：
 *  - events：事件存储表，存储所有原始事件
 *  - sessions：会话表，聚合会话级别的统计信息
 *  - messages：消息表，存储消息级别的详细信息（Token、费用、代码变更等）
 *  - tool_calls：工具调用表，记录工具执行状态和结果
 */

import type { Database } from "bun:sqlite";

export const VERSION = 1;

export function up(db: Database): void {
  // 事件存储表 — 存储所有原始事件
  db.run(`
    CREATE TABLE IF NOT EXISTS events (
      event_id        TEXT PRIMARY KEY,      -- 事件唯一标识
      event_type      TEXT NOT NULL,         -- 事件类型
      session_id      TEXT NOT NULL,         -- 所属会话 ID
      event_contents  TEXT NOT NULL DEFAULT '{}',  -- 事件内容（JSON 格式）
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,  -- 创建时间
      created_at_ms   INTEGER NOT NULL       -- 创建时间（毫秒时间戳）
    )
  `);

  // 会话表 — 聚合会话级别的统计信息
  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_id        TEXT PRIMARY KEY,      -- 会话唯一标识
      project_path      TEXT,                  -- 项目路径
      title             TEXT,                  -- 会话标题
      status            TEXT DEFAULT 'active', -- 会话状态（active/deleted）
      deleted_at_ms     INTEGER,               -- 删除时间（毫秒时间戳）
      first_event_at_ms INTEGER,               -- 首个事件时间
      last_event_at_ms  INTEGER,               -- 最后事件时间
      duration_ms       INTEGER,               -- 持续时长
      created_at        DATETIME DEFAULT CURRENT_TIMESTAMP  -- 创建时间
    )
  `);

  // 消息表 — 存储消息级别的详细信息
  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      message_id        TEXT PRIMARY KEY,      -- 消息唯一标识
      event_id          TEXT NOT NULL,         -- 关联的事件 ID
      session_id        TEXT NOT NULL,         -- 所属会话 ID
      project_path      TEXT NOT NULL,         -- 项目路径
      model             TEXT,                  -- 使用的模型
      role              TEXT NOT NULL,         -- 消息角色（user/assistant）
      agent             TEXT,                  — 代理标识
      input_tokens      INTEGER DEFAULT 0,     — 输入 Token 数
      output_tokens     INTEGER DEFAULT 0,     — 输出 Token 数
      reasoning_tokens  INTEGER DEFAULT 0,     — 推理 Token 数
      cache_read        INTEGER DEFAULT 0,     — 缓存读取 Token 数
      cache_write       INTEGER DEFAULT 0,     — 缓存写入 Token 数
      total_tokens      INTEGER DEFAULT 0,     — 总 Token 数
      cost_usd          REAL DEFAULT 0,        — 费用（美元）
      lines_added       INTEGER DEFAULT 0,     — 新增行数
      lines_deleted     INTEGER DEFAULT 0,     — 删除行数
      files_changed     INTEGER DEFAULT 0,     — 变更文件数
      created_at_ms     INTEGER NOT NULL,      — 创建时间（毫秒时间戳）
      completed_at_ms   INTEGER,               — 完成时间（毫秒时间戳）
      duration_ms       INTEGER,               — 持续时长
      finish_reason     TEXT,                  — 完成原因
      has_error         INTEGER DEFAULT 0,     — 是否有错误
      error_type        TEXT,                  — 错误类型
      created_at        DATETIME DEFAULT CURRENT_TIMESTAMP  — 创建时间
    )
  `);

  // 工具调用表 — 记录工具执行状态和结果
  db.run(`
    CREATE TABLE IF NOT EXISTS tool_calls (
      call_id         TEXT PRIMARY KEY,      -- 调用唯一标识
      session_id      TEXT NOT NULL,         -- 所属会话 ID
      tool_name       TEXT NOT NULL,         -- 工具名称
      status          TEXT,                  -- 执行状态
      started_at_ms   INTEGER,               — 开始时间（毫秒时间戳）
      completed_at_ms INTEGER,               — 完成时间（毫秒时间戳）
      duration_ms     INTEGER,               — 持续时长
      title           TEXT,                  — 结果标题
      error_message   TEXT,                  — 错误信息
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,  — 创建时间
      updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP   — 更新时间
    )
  `);
}
