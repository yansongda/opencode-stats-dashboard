import type { SessionCreatedEvent } from "@defs/events";
import { createBaseEvent } from "@event/utils";
import type { EventSessionCreated } from "@opencode-ai/sdk";

export const eventType = "session.created";

export const convert = (
  event: EventSessionCreated,
  directory: string,
): SessionCreatedEvent => {
  const info = event.properties.info;
  return {
    ...createBaseEvent(),
    event_type: eventType,
    session_id: info.id,
    project_path: info.directory || directory,
    title: info.title ?? "",
  };
};
