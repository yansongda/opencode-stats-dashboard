/**
 * Migration 001: Initial schema — all 5 core tables.
 *
 * Tables:
 *   - events              (Event Store, §3.1)
 *   - sessions            (§4.1)
 *   - models              (§4.2)
 *   - tool_calls          (§4.3)
 *   - snapshots            (§5.1)
 */

import type { Database } from "bun:sqlite";

export const VERSION = 1;

export function up(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS events (
      -- 主键
      event_id        TEXT PRIMARY KEY,
      
      -- 事件信息
      event_type      TEXT NOT NULL,
      session_id      TEXT NOT NULL,
      
      -- 事件内容 (JSON)
      event_contents  TEXT NOT NULL DEFAULT '{}',
      
      -- 时间
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at_ms   INTEGER NOT NULL
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type)");
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at_ms)",
  );

  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      -- 主键
      session_id                TEXT PRIMARY KEY,
      
      -- 基本信息
      project_path              TEXT,
      title                     TEXT,
      
      -- 状态
      status                    TEXT DEFAULT 'active',
      deleted_at_ms             INTEGER,
      
      -- 模型信息
      primary_model             TEXT,
      model_usage               TEXT,
      
      -- 时间维度
      first_event_at_ms         INTEGER,
      last_event_at_ms          INTEGER,
      duration_ms               INTEGER,
      
      -- 消息统计
      user_message_count        INTEGER DEFAULT 0,
      assistant_message_count   INTEGER DEFAULT 0,
      
      -- Token 统计
      total_tokens              INTEGER DEFAULT 0,
      input_tokens              INTEGER DEFAULT 0,
      output_tokens             INTEGER DEFAULT 0,
      reasoning_tokens          INTEGER DEFAULT 0,
      cache_read                INTEGER DEFAULT 0,
      cache_write               INTEGER DEFAULT 0,
      
      -- 费用统计
      total_cost_usd            REAL DEFAULT 0,
      
      -- 工具统计
      tool_call_count           INTEGER DEFAULT 0,
      tool_error_count          INTEGER DEFAULT 0,
      
      -- 文件统计
      files_changed             INTEGER DEFAULT 0,
      lines_added               INTEGER DEFAULT 0,
      lines_deleted             INTEGER DEFAULT 0,
      
      -- 错误统计
      error_count               INTEGER DEFAULT 0,
      
      -- 元数据
      event_count               INTEGER DEFAULT 0,
      created_at                DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS models (
      -- 主键
      event_id          TEXT PRIMARY KEY,

      -- 关联
      session_id        TEXT NOT NULL,

      -- 维度字段
      project_path      TEXT NOT NULL,
      model             TEXT NOT NULL,
      role              TEXT NOT NULL,
      agent             TEXT,
      mode              TEXT,

      -- Token 度量
      input_tokens      INTEGER DEFAULT 0,
      output_tokens     INTEGER DEFAULT 0,
      reasoning_tokens  INTEGER DEFAULT 0,
      cache_read        INTEGER DEFAULT 0,
      cache_write       INTEGER DEFAULT 0,
      total_tokens      INTEGER DEFAULT 0,

      -- 费用
      cost_usd          REAL DEFAULT 0,

      -- 代码变更
      lines_added       INTEGER DEFAULT 0,
      lines_deleted     INTEGER DEFAULT 0,
      files_changed     INTEGER DEFAULT 0,

      -- 时间
      completed_at_ms   INTEGER,
      duration_ms       INTEGER,

      -- 状态
      finish_reason     TEXT,
      has_error         INTEGER DEFAULT 0,
      error_type        TEXT,

      -- 元数据
      created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at_ms     INTEGER NOT NULL
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_models_session ON models(session_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_models_model ON models(model)");
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_models_created ON models(created_at_ms)",
  );
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_models_project_date ON models(project_path, created_at_ms)",
  );

  db.run(`
    CREATE TABLE IF NOT EXISTS tool_calls (
      -- 主键
      call_id         TEXT PRIMARY KEY,
      
      -- 关联
      session_id      TEXT NOT NULL,
      
      -- 工具信息
      tool_name       TEXT NOT NULL,
      status          TEXT,
      
      -- 时间
      started_at_ms     INTEGER,
      completed_at_ms   INTEGER,
      duration_ms       INTEGER,
      
      -- 结果
      title           TEXT,
      error_message   TEXT,
      
      -- 元数据
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_tc_session ON tool_calls(session_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_tc_tool ON tool_calls(tool_name)");
  db.run("CREATE INDEX IF NOT EXISTS idx_tc_status ON tool_calls(status)");
}
