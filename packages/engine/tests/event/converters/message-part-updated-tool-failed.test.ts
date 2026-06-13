import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { convert, eventType } from "../../../src/event/converters/message-part-updated-tool-failed";
import { deterministicBase, installDeterministicBaseEvent, restoreBaseEventGlobals } from "../../helpers/deterministic-base-event";
import { sdkToolFailed, sdkToolPending } from "../../helpers/sdk-events";

describe("message-part-updated-tool-failed converter", () => {
  beforeEach(installDeterministicBaseEvent);
  afterEach(restoreBaseEventGlobals);

  it("declares the shared upstream part event type", () => {
    expect(eventType).toBe("message.part.updated");
  });

  it("maps failed tool parts and computes duration", () => {
    expect(convert(sdkToolFailed(), "/repo")).toEqual([
      { ...deterministicBase, event_type: "tool.execute.failed", session_id: "ses_1", project_path: "/repo", tool_name: "bash", call_id: "call_1", duration_ms: 1_500, error_message: "command failed" },
    ]);
  });

  it("returns no events for non-error tool parts", () => {
    expect(convert(sdkToolPending(), "/repo")).toEqual([]);
  });
});
