import type { SessionUpdatedEvent } from "@defs/events";
import { createBaseEvent } from "@event/utils";
import type { EventSessionUpdated } from "@opencode-ai/sdk";

export const eventType = "session.updated";

export const convert = (
  event: EventSessionUpdated,
  directory: string,
): SessionUpdatedEvent => {
  const info = event.properties.info;
  return {
    ...createBaseEvent(),
    event_type: eventType,
    session_id: info.id,
    project_path: info.directory || directory,
    title: info.title,
  };
};
