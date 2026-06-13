import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { convert, eventType } from "../../../src/event/converters/message-part-updated-tool-completed";
import { deterministicBase, installDeterministicBaseEvent, restoreBaseEventGlobals } from "../../helpers/deterministic-base-event";
import { sdkToolCompleted, sdkToolPending } from "../../helpers/sdk-events";

describe("message-part-updated-tool-completed converter", () => {
  beforeEach(installDeterministicBaseEvent);
  afterEach(restoreBaseEventGlobals);

  it("declares the shared upstream part event type", () => {
    expect(eventType).toBe("message.part.updated");
  });

  it("maps completed tool parts and computes duration", () => {
    expect(convert(sdkToolCompleted(), "/repo")).toEqual([
      { ...deterministicBase, event_type: "tool.execute.completed", session_id: "ses_1", project_path: "/repo", tool_name: "bash", call_id: "call_1", duration_ms: 1_000, title: "listed files" },
    ]);
  });

  it("returns no events for non-completed tool parts", () => {
    expect(convert(sdkToolPending(), "/repo")).toEqual([]);
  });
});
