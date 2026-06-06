import type { BaseStatsEvent } from "@defs/events";

/**
 * Create base event fields shared by all stats events.
 * Eliminates duplication across individual converters.
 */
export function createBaseEvent(): BaseStatsEvent {
  return {
    event_id: crypto.randomUUID(),
    timestamp_ms: Date.now(),
  };
}
