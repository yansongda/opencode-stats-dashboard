import type { StatsEvent } from "@defs/events";
import { createBaseEvent } from "@event/utils";
import type { EventSessionUpdated } from "@opencode-ai/sdk";

export const eventType = "session.updated";

export const convert = (
  event: EventSessionUpdated,
  directory: string,
): StatsEvent[] => {
  const info = event.properties.info;
  return [{
    ...createBaseEvent(),
    event_type: "session.updated",
    session_id: info.id,
    project_path: info.directory || directory,
    title: info.title ?? "",
  }];
};
