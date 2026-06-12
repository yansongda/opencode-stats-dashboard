import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { convert, eventType } from "../../../src/event/converters/session-updated";
import { deterministicBase, installDeterministicBaseEvent, restoreBaseEventGlobals } from "../../helpers/deterministic-base-event";
import { sdkSessionUpdated } from "../../helpers/sdk-events";

describe("session-updated converter", () => {
  beforeEach(installDeterministicBaseEvent);
  afterEach(restoreBaseEventGlobals);

  it("declares the upstream event type", () => {
    expect(eventType).toBe("session.updated");
  });

  it("maps updated session info", () => {
    expect(convert(sdkSessionUpdated({ title: "Renamed" }), "/fallback")).toEqual([
      { ...deterministicBase, event_type: "session.updated", session_id: "ses_1", project_path: "/sdk-repo", title: "Renamed" },
    ]);
  });
});
