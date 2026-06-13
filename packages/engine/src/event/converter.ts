/**
 * 事件转换器注册表
 *
 * 将上游 SDK 事件转换为内部 StatsEvent。支持一个事件类型对应多个转换器，
 * 每个转换器可以生成多个 StatsEvent。
 *
 * 使用方式：
 *  1. 通过 registerConverter() 注册转换器
 *  2. 调用 convertEvent() 执行所有匹配的转换器
 */

import type { Event } from "@opencode-ai/sdk";
import type { StatsEvent } from "@opencode-stats/shared";

type ConvertFn = (event: Event, directory: string) => StatsEvent[];

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

import * as messagePartUpdatedToolCompleted from "./converters/message-part-updated-tool-completed";
import * as messagePartUpdatedToolFailed from "./converters/message-part-updated-tool-failed";
import * as messagePartUpdatedToolPending from "./converters/message-part-updated-tool-pending";
import * as messagePartUpdatedToolRunning from "./converters/message-part-updated-tool-running";
import * as messageUpdatedAssistant from "./converters/message-updated-assistant";
import * as messageUpdatedUser from "./converters/message-updated-user";
import * as sessionCreated from "./converters/session-created";
import * as sessionDeleted from "./converters/session-deleted";
import * as sessionError from "./converters/session-error";
import * as sessionUpdated from "./converters/session-updated";

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
