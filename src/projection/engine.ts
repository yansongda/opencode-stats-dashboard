/**
 * 投影引擎 — 将事件路由到匹配的处理器
 *
 * 负责事件分发和事务管理，不实现具体的投影逻辑。
 *
 * 核心功能：
 *  - 按事件类型路由到匹配的处理器
 *  - 使用事务确保原子性
 *  - 跳过已处理的事件（幂等性）
 *  - 支持批量处理
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

interface HandlerEntry {
  name: string;
  handler: ProjectionHandler;
}

export class ProjectionEngine {
  private readonly db: Database;
  private readonly handlers = new Map<string, HandlerEntry>();
  private readonly processedEvents = new Set<string>();

  /** 内存中保留的最大事件 ID 数量（用于幂等性检查） */
  private static readonly MAX_PROCESSED = 10_000;

  constructor(db: Database) {
    this.db = db;
  }

  // =========================================================================
  // 处理器注册
  // =========================================================================

  registerHandler(name: string, handler: ProjectionHandler): void {
    if (this.handlers.has(name)) {
      throw new Error(`Handler "${name}" is already registered`);
    }
    this.handlers.set(name, { name, handler });
  }

  hasHandler(name: string): boolean {
    return this.handlers.has(name);
  }

  getHandlerNames(): string[] {
    return [...this.handlers.keys()];
  }

  // =========================================================================
  // 事件处理
  // =========================================================================

  /**
   * 处理单个事件
   *
   * 流程：
   *  1. 幂等性检查 — 跳过已处理的事件
   *  2. 查找匹配的处理器
   *  3. 在事务中执行处理器
   *  4. 成功后标记为已处理
   *
   * 如果处理器抛出异常，事务回滚，事件不会被标记为已处理（可重试）。
   */
  processEvent(event: StatsEvent): void {
    // 超过容量时清空集合，依赖 EventStore 的 INSERT OR IGNORE 实现真正的幂等性
    if (this.processedEvents.size >= ProjectionEngine.MAX_PROCESSED) {
      this.processedEvents.clear();
    }

    // 幂等性检查
    if (this.processedEvents.has(event.event_id)) {
      return;
    }

    // 查找匹配的处理器
    const matching = this.findMatchingHandlers(event.event_type);
    if (matching.length === 0) {
      return;
    }

    const txn = this.db.transaction(() => {
      const ctx = createTransactionContext(this.db);
      for (const entry of matching) {
        entry.handler.handle(event, ctx);
      }
    });

    txn();
    // 成功提交后才标记为已处理，失败的事件可以重试
    this.processedEvents.add(event.event_id);
  }

  /**
   * 批量处理多个事件
   *
   * 流程：
   *  1. 过滤已处理的事件（幂等性）
   *  2. 在单个事务中处理所有事件
   *  3. 成功后标记所有事件为已处理
   */
  processEvents(events: StatsEvent[]): void {
    if (events.length === 0) return;

    // 过滤已处理的事件
    const unprocessed = events.filter(
      (event) => !this.processedEvents.has(event.event_id),
    );

    if (unprocessed.length === 0) return;

    // 超过容量时清空集合
    if (this.processedEvents.size >= ProjectionEngine.MAX_PROCESSED) {
      this.processedEvents.clear();
    }

    // 在单个事务中处理所有事件
    const txn = this.db.transaction(() => {
      const ctx = createTransactionContext(this.db);
      for (const event of unprocessed) {
        const matching = this.findMatchingHandlers(event.event_type);
        for (const entry of matching) {
          entry.handler.handle(event, ctx);
        }
      }
    });

    txn();
    // 成功提交后标记为已处理
    for (const event of unprocessed) {
      this.processedEvents.add(event.event_id);
    }
  }

  // =========================================================================
  // 内部方法
  // =========================================================================

  private findMatchingHandlers(eventType: StatsEventType): HandlerEntry[] {
    const result: HandlerEntry[] = [];
    for (const entry of this.handlers.values()) {
      if (entry.handler.handles.includes(eventType)) {
        result.push(entry);
      }
    }
    return result;
  }
}
