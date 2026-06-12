/**
 * 投影引擎 — 将事件路由到匹配的处理器
 *
 * 负责事件分发和事务管理，不实现具体的投影逻辑。
 *
 * 核心功能：
 *  - 按事件类型路由到匹配的处理器
 *  - 使用事务确保原子性
 *  - 支持批量处理
 *
 * 幂等性由 DB 层保证：EventStore 使用 INSERT OR IGNORE，
 * messages 投影使用 UPSERT；事件 ID 为本地 UUID，无跨进程冲突风险。
 */

import type { Database } from "bun:sqlite";
import type { StatsEvent, StatsEventType } from "@defs/events";
import type { ProjectionHandler, TransactionContext } from "@defs/projections";

// ---------------------------------------------------------------------------
// 事务上下文实现
// ---------------------------------------------------------------------------

/** 创建事务上下文，所有查询都在当前事务中执行 */
function createTransactionContext(db: Database): TransactionContext {
  return {
    run(sql: string, params?: unknown[]): void {
      // biome-ignore lint/suspicious/noExplicitAny: bun:sqlite API requires specific binding type
      db.run(sql, params as any);
    },

    query<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[] {
      // biome-ignore lint/suspicious/noExplicitAny: bun:sqlite API requires specific binding type
      return db.query(sql).all(...((params ?? []) as any)) as T[];
    },

    get<T = Record<string, unknown>>(
      sql: string,
      params?: unknown[],
    ): T | null {
      // biome-ignore lint/suspicious/noExplicitAny: bun:sqlite API requires specific binding type
      return (db.query(sql).get(...((params ?? []) as any)) as T) ?? null;
    },
  };
}

// ---------------------------------------------------------------------------
// 投影引擎
// ---------------------------------------------------------------------------

export class ProjectionEngine {
  private readonly db: Database;
  private readonly handlers = new Set<ProjectionHandler>();

  constructor(db: Database) {
    this.db = db;
  }

  // =========================================================================
  // 处理器注册
  // =========================================================================

  registerHandler(handler: ProjectionHandler): void {
    if (this.handlers.has(handler)) {
      throw new Error("Handler is already registered");
    }
    this.handlers.add(handler);
  }

  get size(): number {
    return this.handlers.size;
  }

  // =========================================================================
  // 事件处理
  // =========================================================================

  /**
   * 处理单个事件
   *
   * 幂等性由 DB 层保证（INSERT OR IGNORE / UPSERT），
   * 不维护内存中的已处理集合。
   *
   * 如果处理器抛出异常，事务回滚（可重试）。
   */
  processEvent(event: StatsEvent): void {
    const txn = this.db.transaction(() => {
      const ctx = createTransactionContext(this.db);
      this.applyEvent(event, ctx);
    });

    txn();
  }

  /**
   * 批量处理多个事件
   *
   * 幂等性由 DB 层保证，直接处理所有传入事件。
   */
  processEvents(events: StatsEvent[]): void {
    if (events.length === 0) return;

    // 在单个事务中处理所有事件
    const txn = this.db.transaction(() => {
      const ctx = createTransactionContext(this.db);
      for (const event of events) {
        this.applyEvent(event, ctx);
      }
    });

    txn();
  }

  // =========================================================================
  // 内部方法
  // =========================================================================

  /**
   * 将单个事件应用到匹配的处理器（必须在事务内调用）
   */
  private applyEvent(event: StatsEvent, ctx: TransactionContext): void {
    const matching = this.findMatchingHandlers(event.event_type);
    if (matching.length === 0) {
      return;
    }
    for (const handler of matching) {
      handler.handle(event, ctx);
    }
  }

  private findMatchingHandlers(eventType: StatsEventType): ProjectionHandler[] {
    const result: ProjectionHandler[] = [];
    for (const handler of this.handlers) {
      if (handler.handles.includes(eventType)) {
        result.push(handler);
      }
    }
    return result;
  }
}
