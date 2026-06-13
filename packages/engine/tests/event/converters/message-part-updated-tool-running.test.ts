import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { convert, eventType } from "../../../src/event/converters/message-part-updated-tool-running";
import { deterministicBase, installDeterministicBaseEvent, restoreBaseEventGlobals } from "../../helpers/deterministic-base-event";
import { sdkToolPending, sdkToolRunning } from "../../helpers/sdk-events";

describe("message-part-updated-tool-running converter", () => {
  beforeEach(installDeterministicBaseEvent);
  afterEach(restoreBaseEventGlobals);

  it("declares the shared upstream part event type", () => {
    expect(eventType).toBe("message.part.updated");
  });

  it("maps running tool parts", () => {
    expect(convert(sdkToolRunning(), "/repo")).toEqual([
      { ...deterministicBase, event_type: "tool.execute.running", session_id: "ses_1", project_path: "/repo", tool_name: "bash", call_id: "call_1" },
    ]);
  });

  it("returns no events for non-running tool parts", () => {
    expect(convert(sdkToolPending(), "/repo")).toEqual([]);
  });
});
