import type { EventSessionCreated } from "@opencode-ai/sdk";
import type { StatsEvent } from "@opencode-stats/shared";
import { createBaseEvent } from "@opencode-stats/shared";

export const eventType = "session.created";

export const convert = (
  event: EventSessionCreated,
  directory: string,
): StatsEvent[] => {
  const info = event.properties.info;
  return [
    {
      ...createBaseEvent(),
      event_type: "session.created",
      session_id: info.id,
      project_path: info.directory || directory,
      title: info.title ?? "",
    },
  ];
};
