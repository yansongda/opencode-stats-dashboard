import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { convert, eventType } from "../../../src/event/converters/session-deleted";
import { deterministicBase, installDeterministicBaseEvent, restoreBaseEventGlobals } from "../../helpers/deterministic-base-event";
import { sdkSessionDeleted } from "../../helpers/sdk-events";

describe("session-deleted converter", () => {
  beforeEach(installDeterministicBaseEvent);
  afterEach(restoreBaseEventGlobals);

  it("declares the upstream event type", () => {
    expect(eventType).toBe("session.deleted");
  });

  it("maps deleted session info", () => {
    expect(convert(sdkSessionDeleted(), "/fallback")).toEqual([
      { ...deterministicBase, event_type: "session.deleted", session_id: "ses_1", project_path: "/sdk-repo" },
    ]);
  });
});
