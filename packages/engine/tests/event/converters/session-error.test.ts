import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { convert, eventType } from "../../../src/event/converters/session-error";
import { deterministicBase, installDeterministicBaseEvent, restoreBaseEventGlobals } from "../../helpers/deterministic-base-event";
import { sdkSessionError } from "../../helpers/sdk-events";

describe("session-error converter", () => {
  beforeEach(installDeterministicBaseEvent);
  afterEach(restoreBaseEventGlobals);

  it("declares the upstream event type", () => {
    expect(eventType).toBe("session.error");
  });

  it("maps error data into a session error StatsEvent", () => {
    expect(convert(sdkSessionError(), "/repo")).toEqual([
      { ...deterministicBase, event_type: "session.error", session_id: "ses_1", project_path: "/repo", error_type: "UnknownError", error_message: "session exploded" },
    ]);
  });

  it("handles missing session and error data", () => {
    expect(convert(sdkSessionError({ sessionID: undefined, error: undefined }), "/repo")).toEqual([
      { ...deterministicBase, event_type: "session.error", session_id: "", project_path: "/repo", error_type: "unknown", error_message: "" },
    ]);
  });
});
