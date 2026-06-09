// src/event/converters/message-part-updated-tool-running.ts
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

  // 只处理 running 状态
  if (part.state.status !== "running") return [];

  return [
    {
      ...createBaseEvent(),
      event_type: "tool.execute.running",
      session_id: part.sessionID,
      project_path: directory,
      tool_name: part.tool,
      call_id: part.callID,
    },
  ];
};
