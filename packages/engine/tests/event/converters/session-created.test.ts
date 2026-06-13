import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { convert, eventType } from "../../../src/event/converters/session-created";
import { deterministicBase, installDeterministicBaseEvent, restoreBaseEventGlobals } from "../../helpers/deterministic-base-event";
import { sdkSessionCreated } from "../../helpers/sdk-events";

describe("session-created converter", () => {
  beforeEach(installDeterministicBaseEvent);
  afterEach(restoreBaseEventGlobals);

  it("declares the upstream event type", () => {
    expect(eventType).toBe("session.created");
  });

  it("maps session info into a StatsEvent", () => {
    expect(convert(sdkSessionCreated(), "/fallback")).toEqual([
      { ...deterministicBase, event_type: "session.created", session_id: "ses_1", project_path: "/sdk-repo", title: "SDK session" },
    ]);
  });

  it("falls back to input directory and empty title", () => {
    expect(convert(sdkSessionCreated({ directory: "", title: "" }), "/fallback")[0]).toMatchObject({
      project_path: "/fallback",
      title: "",
    });
  });
});
