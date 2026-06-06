import type { SessionDeletedEvent } from "@defs/events";
import { createBaseEvent } from "@event/utils";
import type { EventSessionDeleted } from "@opencode-ai/sdk";

export const eventType = "session.deleted";

export const convert = (
  event: EventSessionDeleted,
  directory: string,
): SessionDeletedEvent => {
  const info = event.properties.info;
  return {
    ...createBaseEvent(),
    event_type: eventType,
    session_id: info.id,
    project_path: info.directory || directory,
  };
};
