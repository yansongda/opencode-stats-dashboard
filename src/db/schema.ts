/**
 * SQLite 模式迁移与 PRAGMA 配置
 *
 * 负责数据库初始化、迁移管理和性能优化。所有表结构变更通过版本化迁移脚本实现，
 * 确保数据库状态的一致性和可追溯性。
 *
 * 核心功能：
 *  - 管理数据库模式版本（schema_migrations 表）
 *  - 执行版本化迁移脚本（001_initial.ts 等）
 *  - 配置 SQLite PRAGMA 以优化性能
 *
 * 管理的表结构：
 *  - events：事件存储表
 *  - sessions：会话表
 *  - messages：消息表
 *  - tool_calls：工具调用表
 *  - schema_migrations：迁移版本追踪表
 */

import type { Database } from "bun:sqlite";
import * as m001 from "@db/migrations/001_initial";

/** 所有迁移模块，按版本顺序排列 */
const MIGRATIONS = [m001];

/** 当前最新模式版本，由迁移列表长度决定 */
export const CURRENT_VERSION = MIGRATIONS.length;

/** PRAGMA journal_mode 重试次数上限 */
const WAL_RETRY_COUNT = 10;

/** PRAGMA journal_mode 单次重试等待毫秒 */
const WAL_RETRY_DELAY_MS = 500;

/**
 * 配置 SQLite PRAGMA 以优化性能
 *
 * 配置说明：
 *  - busy_timeout = 5000：为 DML 操作注册 busy handler（PRAGMA 语句不走 busy handler）
 *  - journal_mode = WAL：启用预写日志，支持并发读取和单写入者；并发启动时可能遇到
 *    SQLITE_BUSY，因此在 busy_timeout 之上再做显式重试循环
 *  - synchronous = NORMAL：在 WAL 模式下提供良好的持久性保证
 */
export function configurePragmas(db: Database): void {
  db.run("PRAGMA busy_timeout = 5000");

  for (let attempt = 0; attempt <= WAL_RETRY_COUNT; attempt++) {
    try {
      db.run("PRAGMA journal_mode = WAL");
      break;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const isBusy =
        (e as { code?: string }).code === "SQLITE_BUSY" ||
        msg.includes("SQLITE_BUSY") ||
        msg.includes("database is locked");
      if (!isBusy || attempt === WAL_RETRY_COUNT) {
        throw e;
      }
      Atomics.wait(
        new Int32Array(new SharedArrayBuffer(4)),
        0,
        0,
        WAL_RETRY_DELAY_MS,
      );
    }
  }

  db.run("PRAGMA synchronous = NORMAL");
}

/**
 * 获取已应用的最高迁移版本号
 *
 * @returns 最高版本号，如果没有迁移记录则返回 0
 */
function currentVersion(db: Database): number {
  const exists = db
    .query(
      "SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name='schema_migrations'",
    )
    .get() as { cnt: number } | null;

  if (!exists || exists.cnt === 0) {
    return 0;
  }

  const row = db
    .query("SELECT COALESCE(MAX(version), 0) as v FROM schema_migrations")
    .get() as { v: number } | null;

  return row?.v ?? 0;
}

/** 确保 schema_migrations 追踪表存在 */
function ensureMigrationsTable(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

/**
 * 执行所有待处理的迁移（在单个事务中）
 *
 * 幂等操作，可安全重复调用。
 *
 * @returns 已应用的迁移数量（如果已是最新则返回 0）
 */
export function runMigrations(db: Database): number {
  ensureMigrationsTable(db);
  const current = currentVersion(db);
  let appliedCount = 0;

  const tx = db.transaction(() => {
    for (let i = 0; i < MIGRATIONS.length; i++) {
      const migration = MIGRATIONS[i];
      if (!migration) continue;
      const version = i + 1;
      if (version <= current) {
        continue;
      }
      migration.up(db);
      // INSERT OR IGNORE 保证并发进程同时执行同一迁移时不会冲突；
      // 外层 try/catch 作为防御性兜底，仅容忍主键冲突，其余错误继续抛出。
      let inserted = false;
      try {
        const result = db.run(
          "INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)",
          [version],
        );
        inserted = result.changes > 0;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        const isPkConflict =
          (e as { code?: string }).code === "SQLITE_CONSTRAINT_PRIMARYKEY" ||
          msg.includes("UNIQUE constraint failed: schema_migrations");
        if (!isPkConflict) {
          throw e;
        }
      }
      if (inserted) appliedCount++;
    }
  });

  tx();
  return appliedCount;
}
