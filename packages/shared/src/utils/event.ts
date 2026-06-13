import type { BaseStatsEvent, TokenBreakdown } from "@defs/events";

/**
 * 创建基础事件对象
 *
 * 生成包含唯一标识和时间戳的基础事件，用于构建所有 StatsEvent。
 *
 * @returns 包含 event_id (UUID) 和 created_at_ms (当前时间戳) 的基础事件对象
 */
export function createBaseEvent(): BaseStatsEvent {
  return {
    event_id: crypto.randomUUID(),
    created_at_ms: Date.now(),
  };
}

/**
 * 创建零值 Token 分解对象
 *
 * 返回所有 Token 计数为零的默认结构，用于初始化或作为 fallback。
 *
 * @returns 零值 TokenBreakdown 对象
 */
export function defaultTokens(): TokenBreakdown {
  return { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } };
}

/**
 * 标准化 Token 分解对象
 *
 * 从松散的输入（可能来自外部 SDK）构造合法的 TokenBreakdown。
 * 处理缺失字段、类型错误和嵌套对象，确保返回值符合类型定义。
 *
 * @param value - 待标准化的 Token 数据（可能来自 SDK 事件）
 * @returns 标准化后的 TokenBreakdown，如果输入无效则返回 undefined
 */
export function normalizeTokens(value: unknown): TokenBreakdown | undefined {
  if (!value || typeof value !== "object") return undefined;
  const t = value as Record<string, unknown>;
  const cacheRaw =
    t.cache && typeof t.cache === "object"
      ? (t.cache as Record<string, unknown>)
      : {};
  return {
    input: typeof t.input === "number" ? t.input : 0,
    output: typeof t.output === "number" ? t.output : 0,
    reasoning: typeof t.reasoning === "number" ? t.reasoning : 0,
    cache: {
      read: typeof cacheRaw.read === "number" ? cacheRaw.read : 0,
      write: typeof cacheRaw.write === "number" ? cacheRaw.write : 0,
    },
  };
}
