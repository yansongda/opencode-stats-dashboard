import type { StatsEvent } from "@defs/events";
import { createBaseEvent, defaultTokens } from "@event/utils";
import type { EventMessageUpdated } from "@opencode-ai/sdk";

export const eventType = "message.updated";

export const convert = (
  event: EventMessageUpdated,
  directory: string,
): StatsEvent[] => {
  const info = event.properties.info;

  if (info.role !== "assistant") return [];

  const completed_at_ms = info.time.completed;
  const created_at_ms = info.time.created;
  const duration_ms =
    completed_at_ms && created_at_ms
      ? completed_at_ms - created_at_ms
      : undefined;

  const has_error = info.error ? 1 : 0;
  const error_type = info.error?.name;

  const model = info.modelID
    ? `${info.providerID ?? "unknown"}/${info.modelID}`
    : "";

  return [
    {
      ...createBaseEvent(),
      event_type: "message.updated.assistant",
      message_id: info.id,
      session_id: info.sessionID,
      project_path: directory,
      model,
      agent: info.mode,
      tokens: info.tokens ?? defaultTokens(),
      cost_usd: info.cost ?? 0,
      created_at_ms,
      completed_at_ms,
      duration_ms,
      finish_reason: info.finish,
      has_error,
      error_type,
    },
  ];
};
