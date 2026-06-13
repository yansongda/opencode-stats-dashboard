import type { EventSessionDeleted } from "@opencode-ai/sdk";
import type { StatsEvent } from "@opencode-stats/shared";
import { createBaseEvent } from "@opencode-stats/shared";

export const eventType = "session.deleted";

export const convert = (
  event: EventSessionDeleted,
  directory: string,
): StatsEvent[] => {
  const info = event.properties.info;
  return [
    {
      ...createBaseEvent(),
      event_type: "session.deleted",
      session_id: info.id,
      project_path: info.directory || directory,
    },
  ];
};
