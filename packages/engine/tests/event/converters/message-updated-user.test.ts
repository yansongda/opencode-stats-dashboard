import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { convert, eventType } from "../../../src/event/converters/message-updated-user";
import { deterministicBase, installDeterministicBaseEvent, restoreBaseEventGlobals } from "../../helpers/deterministic-base-event";
import { sdkAssistantMessage, sdkUserMessage } from "../../helpers/sdk-events";

describe("message-updated-user converter", () => {
  beforeEach(installDeterministicBaseEvent);
  afterEach(restoreBaseEventGlobals);

  it("declares the shared upstream message event type", () => {
    expect(eventType).toBe("message.updated");
  });

  it("maps user message metadata and diff summary", () => {
    const event = sdkUserMessage({
      summary: {
        diffs: [
          { file: "a.ts", before: "", after: "", additions: 3, deletions: 1 },
          { file: "b.ts", before: "", after: "", additions: 4, deletions: 2 },
        ],
      },
    });

    expect(convert(event, "/repo")).toEqual([
      { ...deterministicBase, event_type: "message.updated.user", message_id: "msg_user_1", session_id: "ses_1", project_path: "/repo", role: "user", agent: "coder", lines_added: 7, lines_deleted: 3, files_changed: 2, created_at_ms: 3_000 },
    ]);
  });

  it("returns no events for assistant messages", () => {
    expect(convert(sdkAssistantMessage(), "/repo")).toEqual([]);
  });
});
