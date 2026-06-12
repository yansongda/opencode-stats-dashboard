import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { convert, eventType } from "../../../src/event/converters/message-part-updated-tool-pending";
import { deterministicBase, installDeterministicBaseEvent, restoreBaseEventGlobals } from "../../helpers/deterministic-base-event";
import { sdkToolPending, sdkToolRunning } from "../../helpers/sdk-events";

describe("message-part-updated-tool-pending converter", () => {
  beforeEach(installDeterministicBaseEvent);
  afterEach(restoreBaseEventGlobals);

  it("declares the shared upstream part event type", () => {
    expect(eventType).toBe("message.part.updated");
  });

  it("maps pending tool parts", () => {
    expect(convert(sdkToolPending(), "/repo")).toEqual([
      { ...deterministicBase, event_type: "tool.execute.pending", session_id: "ses_1", project_path: "/repo", tool_name: "bash", call_id: "call_1" },
    ]);
  });

  it("returns no events for non-pending tool parts", () => {
    expect(convert(sdkToolRunning(), "/repo")).toEqual([]);
  });
});
