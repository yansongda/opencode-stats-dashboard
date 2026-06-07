import type { BaseStatsEvent, TokenBreakdown } from "@defs/events";

export function createBaseEvent(): BaseStatsEvent {
  return {
    event_id: crypto.randomUUID(),
    timestamp_ms: Date.now(),
  };
}

export function defaultTokens(): TokenBreakdown {
  return { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } };
}

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
