import type { StatsEvent } from "@defs/events";
import { createBaseEvent } from "@event/utils";
import type { EventSessionError } from "@opencode-ai/sdk";

export const eventType = "session.error";

export const convert = (
  event: EventSessionError,
  directory: string,
): StatsEvent[] => {
  const err = event.properties.error;
  const errorData =
    err && "data" in err && typeof err.data === "object" && err.data !== null
      ? (err.data as Record<string, unknown>)
      : undefined;
  return [
    {
      ...createBaseEvent(),
      event_type: "session.error",
      session_id: event.properties.sessionID ?? "",
      project_path: directory,
      error_type: err?.name ?? "unknown",
      error_message:
        typeof errorData?.message === "string" ? errorData.message : "",
    },
  ];
};
