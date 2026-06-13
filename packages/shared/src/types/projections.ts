/**
 * 投影类型定义
 *
 * 投影是从事件派生的物化视图。
 * 三个主要投影：sessions、messages 和 tool_calls。
 */

import type { StatsEvent, StatsEventType } from "@defs/events";

// ============================================================================
// 事务上下文
// ============================================================================

/**
 * 数据库方法的轻量级包装，用于事务内操作
 *
 * 通过此上下文执行的所有查询都属于同一事务 —
 * 如果处理器抛出异常，所有操作自动回滚
 */
export interface TransactionContext {
  /** 执行 SQL 语句（INSERT、UPDATE、DELETE） */
  run(sql: string, params?: unknown[]): void;

  /** 执行查询并返回所有行 */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[];

  /** 执行查询并返回第一行，或 null */
  get<T = Record<string, unknown>>(sql: string, params?: unknown[]): T | null;
}

// ============================================================================
// 投影处理器
// ============================================================================

/**
 * 投影处理器处理特定类型的事件
 *
 * @example
 * ```ts
 * const sessionHandler: ProjectionHandler = {
 *   handles: ["session.created", "session.updated"],
 *   handle: (event, txn) => {
 *     txn.run("INSERT INTO projection_sessions ...", [...])
 *   },
 * }
 * ```
 */
export interface ProjectionHandler {
  /** 此处理器可以处理的事件类型 */
  handles: StatsEventType[];

  /**
   * 在事务中处理单个事件
   *
   * @param event - 要处理的事件
   * @param txn - 数据库操作的事务上下文
   * @throws 如果处理器失败，整个事务回滚
   */
  handle(event: StatsEvent, txn: TransactionContext): void;
}
