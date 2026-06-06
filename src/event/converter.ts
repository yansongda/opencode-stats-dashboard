import type {
  StatsEvent,
  TokenBreakdown,
  ToolCompletedEvent,
  ToolEventInput,
  ToolEventOutput,
} from "@defs/events";
import * as fileEdited from "@event/converters/file-edited";
import * as messageUpdated from "@event/converters/message-updated";
import * as sessionCreated from "@event/converters/session-created";
import * as sessionDeleted from "@event/converters/session-deleted";
import * as sessionDiff from "@event/converters/session-diff";
import * as sessionError from "@event/converters/session-error";
import { createBaseEvent } from "@event/utils";
import type { Event } from "@opencode-ai/sdk";

type ConvertFn = (event: Event, directory: string) => StatsEvent | null;

const REGISTERED = [
  fileEdited,
  messageUpdated,
  sessionCreated,
  sessionDeleted,
  sessionDiff,
  sessionError,
] as const;

const converters: Record<string, ConvertFn> = {};
for (const m of REGISTERED) {
  converters[m.eventType] = m.convert as ConvertFn;
}

export function convertEvent(
  event: Event,
  directory: string,
): StatsEvent | null {
  const fn = converters[event.type];
  return fn ? fn(event, directory) : null;
}

function normalizeTokens(value: unknown): TokenBreakdown | undefined {
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

export function convertToolEvent(
  input: ToolEventInput,
  output: ToolEventOutput,
  directory: string,
): ToolCompletedEvent {
  const m = output.metadata;
  return {
    ...createBaseEvent(),
    event_type: "tool.completed",
    session_id: input.sessionID,
    project_path: directory,
    tool_name: input.tool,
    call_id: input.callID,
    duration_ms: typeof m.duration_ms === "number" ? m.duration_ms : 0,
    title: output.title,
    tokens: normalizeTokens(m.tokens),
    cost_usd: typeof m.cost_usd === "number" ? m.cost_usd : 0,
  };
}
