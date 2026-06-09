import type { StatsEvent } from "@defs/events";
import { createBaseEvent } from "@event/utils";
import type { EventMessageUpdated } from "@opencode-ai/sdk";

export const eventType = "message.updated";

export const convert = (
  event: EventMessageUpdated,
  directory: string,
): StatsEvent[] => {
  const info = event.properties.info;

  // 只处理 user 角色
  if (info.role !== "user") return [];

  const summary = info.summary;
  let lines_added = 0;
  let lines_deleted = 0;
  let files_changed = 0;

  if (summary && typeof summary !== "boolean" && "diffs" in summary) {
    for (const d of summary.diffs) {
      lines_added += d.additions;
      lines_deleted += d.deletions;
    }
    files_changed = summary.diffs.length;
  }

  return [{
    ...createBaseEvent(),
    event_type: "message.updated.user",
    message_id: info.id,
    session_id: info.sessionID,
    project_path: directory,
    role: "user",
    agent: info.agent,
    lines_added,
    lines_deleted,
    files_changed,
    created_at_ms: info.time.created,
  }];
};
