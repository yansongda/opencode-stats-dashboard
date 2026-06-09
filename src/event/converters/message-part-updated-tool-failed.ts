import type { StatsEvent } from "@defs/events";
import { createBaseEvent } from "@event/utils";
import type { EventMessagePartUpdated } from "@opencode-ai/sdk";

export const eventType = "message.part.updated";

export const convert = (
  event: EventMessagePartUpdated,
  directory: string,
): StatsEvent[] => {
  const { part } = event.properties;

  // 只处理 tool 类型
  if (part.type !== "tool") return [];

  // 只处理 error 状态
  if (part.state.status !== "error") return [];

  const start = part.state.time.start;
  const end = part.state.time.end;
  const duration_ms = start > 0 && end > start ? end - start : 0;

  return [{
    ...createBaseEvent(),
    event_type: "tool.execute.failed",
    session_id: part.sessionID,
    project_path: directory,
    tool_name: part.tool,
    call_id: part.callID,
    duration_ms,
    error_message: part.state.error,
  }];
};
