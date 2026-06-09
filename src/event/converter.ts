import type {
  StatsEvent,
} from "@defs/events";
import * as messageUpdated from "@event/converters/message-updated";
import * as messagePartUpdated from "@event/converters/message-part-updated";
import * as sessionCreated from "@event/converters/session-created";
import * as sessionDeleted from "@event/converters/session-deleted";
import * as sessionError from "@event/converters/session-error";
import * as sessionUpdated from "@event/converters/session-updated";
import type { Event } from "@opencode-ai/sdk";

type ConvertFn = (event: Event, directory: string) => StatsEvent[];

const REGISTERED = [
  messageUpdated,
  messagePartUpdated,
  sessionCreated,
  sessionUpdated,
  sessionDeleted,
  sessionError,
] as const;

const converters = new Map<string, ConvertFn>(
  REGISTERED.map((m) => [m.eventType, m.convert as ConvertFn]),
);

export function convertEvent(
  event: Event,
  directory: string,
): StatsEvent[] {
  const fn = converters.get(event.type);
  return fn ? fn(event, directory) : [];
}
