import type { EventMessagePartUpdated } from "@opencode-ai/sdk";
import type { StatsEvent } from "@opencode-stats/shared";
import { createBaseEvent } from "@opencode-stats/shared";

export const eventType = "message.part.updated";

export const convert = (
  event: EventMessagePartUpdated,
  directory: string,
): StatsEvent[] => {
  const { part } = event.properties;

  if (part.type !== "tool") return [];
  if (part.state.status !== "error") return [];

  const start = part.state.time.start;
  const end = part.state.time.end;
  const duration_ms = start > 0 && end > start ? end - start : 0;

  return [
    {
      ...createBaseEvent(),
      event_type: "tool.execute.failed",
      session_id: part.sessionID,
      project_path: directory,
      tool_name: part.tool,
      call_id: part.callID,
      duration_ms,
      error_message: part.state.error,
    },
  ];
};
