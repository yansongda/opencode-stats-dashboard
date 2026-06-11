import type { StatsEvent } from "@defs/events";
import { createBaseEvent } from "@event/utils";
import type { EventMessagePartUpdated } from "@opencode-ai/sdk";

export const eventType = "message.part.updated";

export const convert = (
  event: EventMessagePartUpdated,
  directory: string,
): StatsEvent[] => {
  const { part } = event.properties;

  if (part.type !== "tool") return [];
  if (part.state.status !== "pending") return [];

  return [
    {
      ...createBaseEvent(),
      event_type: "tool.execute.pending",
      session_id: part.sessionID,
      project_path: directory,
      tool_name: part.tool,
      call_id: part.callID,
    },
  ];
};
