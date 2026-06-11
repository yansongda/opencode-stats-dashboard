import type { TokenBreakdown } from "@defs/events";

/**
 * 计算总 Token 数量
 *
 * 将所有 Token 类型（输入、输出、推理、缓存读取、缓存写入）相加，
 * 返回总 Token 数量。用于消息投影和统计计算。
 *
 * @param tokens - Token 分解对象
 * @returns 总 Token 数量
 */
export function totalTokens(tokens: TokenBreakdown): number {
  return (
    tokens.input +
    tokens.output +
    tokens.reasoning +
    tokens.cache.read +
    tokens.cache.write
  );
}
