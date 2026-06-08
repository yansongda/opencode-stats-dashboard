import type {
  StatsEvent,
  ToolExecuteAfterEvent,
  ToolExecuteBeforeEvent,
} from "@defs/events";
import * as fileEdited from "@event/converters/file-edited";
import * as messageUpdated from "@event/converters/message-updated";
import * as sessionCreated from "@event/converters/session-created";
import * as sessionDeleted from "@event/converters/session-deleted";
import * as sessionDiff from "@event/converters/session-diff";
import * as sessionError from "@event/converters/session-error";
import * as sessionUpdated from "@event/converters/session-updated";
import { createBaseEvent } from "@event/utils";
import type { Event } from "@opencode-ai/sdk";

type ConvertFn = (event: Event, directory: string) => StatsEvent | null;

const REGISTERED = [
  fileEdited,
  messageUpdated,
  sessionCreated,
  sessionUpdated,
  sessionDeleted,
  sessionDiff,
  sessionError,
] as const;

const converters = new Map<string, ConvertFn>(
  REGISTERED.map((m) => [m.eventType, m.convert as ConvertFn]),
);

export function convertEvent(
  event: Event,
  directory: string,
): StatsEvent | null {
  const fn = converters.get(event.type);
  return fn ? fn(event, directory) : null;
}

export function convertToolExecuteBeforeEvent(
  input: { tool: string; sessionID: string; callID: string },
  directory: string,
): ToolExecuteBeforeEvent {
  return {
    ...createBaseEvent(),
    event_type: "tool.execute.before",
    session_id: input.sessionID,
    project_path: directory,
    tool_name: input.tool,
    call_id: input.callID,
  };
}

export function convertToolExecuteAfterEvent(
  input: { tool: string; sessionID: string; callID: string; args: unknown },
  output: { title: string; output: string; metadata: Record<string, unknown> },
  directory: string,
): ToolExecuteAfterEvent {
  const m = output.metadata ?? {};
  return {
    ...createBaseEvent(),
    event_type: "tool.execute.after",
    session_id: input.sessionID,
    project_path: directory,
    tool_name: input.tool,
    call_id: input.callID,
    duration_ms: typeof m.duration_ms === "number" ? m.duration_ms : 0,
    title: output.title,
  };
}
