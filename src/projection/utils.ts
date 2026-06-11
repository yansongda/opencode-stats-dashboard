import type { TokenBreakdown } from "@defs/events";

export function totalTokens(tokens: TokenBreakdown): number {
  return (
    tokens.input +
    tokens.output +
    tokens.reasoning +
    tokens.cache.read +
    tokens.cache.write
  );
}
