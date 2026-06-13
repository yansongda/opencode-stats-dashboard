/**
 * 事件存储层 — 追加式事件持久化
 *
 * 提供幂等写入（INSERT OR IGNORE）和查询功能，使用预编译语句提升性能。
 *
 * 设计原则：
 *  - 不可变性：事件不会被修改或删除
 *  - 幂等性：重复的 event_id 会被静默忽略
 *  - 完整性：保留所有原始信息
 *  - 可追溯性：每个事件都有时间戳和关联信息
 */

import type { Database, SQLQueryBindings, Statement } from "bun:sqlite";
import type { StatsEvent } from "@opencode-stats/shared";

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

/** SQLite 兼容的参数类型 */
type SQLiteParam = SQLQueryBindings;

export interface EventRow {
  event_id: string;
  event_type: string;
  session_id: string;
  created_at_ms: number;
  created_at: string;
  event_contents: string;
}

export interface EventQueryFilters {
  session_id?: string;
  event_type?: string;
  start_ms?: number;
  end_ms?: number;
  limit?: number;
  offset?: number;
}

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

/**
 * 根据过滤条件构建 WHERE 子句
 *
 * @returns [whereSql, params] — whereSql 为空字符串表示无条件
 */
function buildWhere(filters?: EventQueryFilters): [string, unknown[]] {
  if (!filters) return ["", []];

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.session_id !== undefined) {
    conditions.push("session_id = ?");
    params.push(filters.session_id);
  }
  if (filters.event_type !== undefined) {
    conditions.push("event_type = ?");
    params.push(filters.event_type);
  }
  if (filters.start_ms !== undefined) {
    conditions.push("created_at_ms >= ?");
    params.push(filters.start_ms);
  }
  if (filters.end_ms !== undefined) {
    conditions.push("created_at_ms <= ?");
    params.push(filters.end_ms);
  }

  const whereSql =
    conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
  return [whereSql, params];
}

// ---------------------------------------------------------------------------
// 事件存储
// ---------------------------------------------------------------------------

export class EventStore {
  private db: Database;
  private stmtInsert: Statement;
  private stmtGetById: Statement;
  private queryCache = new Map<string, Statement>();

  constructor(db: Database) {
    this.db = db;

    this.stmtInsert = db.query(`
      INSERT OR IGNORE INTO events
        (event_id, event_type, session_id, created_at_ms, event_contents)
      VALUES (?, ?, ?, ?, ?)
    `);

    this.stmtGetById = db.query("SELECT * FROM events WHERE event_id = ?");
  }

  private extractParams(event: StatsEvent): SQLiteParam[] {
    const session_id = "session_id" in event ? event.session_id : "";

    const { event_id, event_type, created_at_ms, ...rest } = event;
    return [
      event_id,
      event_type,
      session_id,
      created_at_ms,
      JSON.stringify(rest),
    ];
  }

  insertEvent(event: StatsEvent): boolean {
    const result = this.stmtInsert.run(...this.extractParams(event));
    return result.changes === 1;
  }

  insertEvents(events: StatsEvent[]): number {
    if (events.length === 0) return 0;

    let inserted = 0;
    const tx = this.db.transaction(() => {
      for (const event of events) {
        if (this.insertEvent(event)) {
          inserted++;
        }
      }
    });
    tx();
    return inserted;
  }

  getEventById(eventId: string): EventRow | null {
    return (this.stmtGetById.get(eventId) as EventRow) ?? null;
  }

  private getCachedStatement(sql: string): Statement {
    let stmt = this.queryCache.get(sql);
    if (!stmt) {
      stmt = this.db.query(sql);
      this.queryCache.set(sql, stmt);
    }
    return stmt;
  }

  getEvents(filters?: EventQueryFilters): EventRow[] {
    const [whereSql, params] = buildWhere(filters);

    let sql = `SELECT * FROM events${whereSql} ORDER BY created_at_ms ASC`;

    if (filters?.limit !== undefined) {
      sql += ` LIMIT ?`;
      params.push(filters.limit);
    }
    if (filters?.offset !== undefined) {
      sql += ` OFFSET ?`;
      params.push(filters.offset);
    }

    return this.getCachedStatement(sql).all(
      ...(params as SQLiteParam[]),
    ) as EventRow[];
  }

  countEvents(filters?: EventQueryFilters): number {
    const [whereSql, params] = buildWhere(filters);
    const sql = `SELECT COUNT(*) as cnt FROM events${whereSql}`;
    const row = this.getCachedStatement(sql).get(
      ...(params as SQLiteParam[]),
    ) as { cnt: number };
    return row.cnt;
  }
}
