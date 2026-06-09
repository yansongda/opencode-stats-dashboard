import type { StatsEvent } from "@defs/events";
import type { Event } from "@opencode-ai/sdk";

type ConvertFn = (event: Event, directory: string) => StatsEvent[];

// 一个事件类型对应多个 converter
const converters = new Map<string, ConvertFn[]>();

export function registerConverter(eventType: string, fn: ConvertFn): void {
  const existing = converters.get(eventType) ?? [];
  existing.push(fn);
  converters.set(eventType, existing);
}

export function convertEvent(event: Event, directory: string): StatsEvent[] {
  const fns = converters.get(event.type) ?? [];
  const results: StatsEvent[] = [];
  for (const fn of fns) {
    results.push(...fn(event, directory));
  }
  return results;
}

// 注册所有 converter
import * as sessionCreated from "@event/converters/session-created";
import * as sessionUpdated from "@event/converters/session-updated";
import * as sessionDeleted from "@event/converters/session-deleted";
import * as sessionError from "@event/converters/session-error";
import * as messageUpdatedUser from "@event/converters/message-updated-user";
import * as messageUpdatedAssistant from "@event/converters/message-updated-assistant";
import * as messagePartUpdatedToolPending from "@event/converters/message-part-updated-tool-pending";
import * as messagePartUpdatedToolRunning from "@event/converters/message-part-updated-tool-running";
import * as messagePartUpdatedToolCompleted from "@event/converters/message-part-updated-tool-completed";
import * as messagePartUpdatedToolFailed from "@event/converters/message-part-updated-tool-failed";

const REGISTERED = [
  sessionCreated,
  sessionUpdated,
  sessionDeleted,
  sessionError,
  messageUpdatedUser,
  messageUpdatedAssistant,
  messagePartUpdatedToolPending,
  messagePartUpdatedToolRunning,
  messagePartUpdatedToolCompleted,
  messagePartUpdatedToolFailed,
] as const;

for (const mod of REGISTERED) {
  registerConverter(mod.eventType, mod.convert as ConvertFn);
}
