import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { convertEvent, registerConverter } from "../../src/event/converter";
import { deterministicBase, installDeterministicBaseEvent, restoreBaseEventGlobals } from "../helpers/deterministic-base-event";
import { sdkSessionCreated, sdkToolCompleted, sdkUserMessage } from "../helpers/sdk-events";
import { sessionCreated } from "../helpers/stats-events";

describe("event converter registry", () => {
  beforeEach(installDeterministicBaseEvent);
  afterEach(restoreBaseEventGlobals);

  it("auto-registers built-in session converters", () => {
    expect(convertEvent(sdkSessionCreated(), "/fallback")).toEqual([
      { ...deterministicBase, event_type: "session.created", session_id: "ses_1", project_path: "/sdk-repo", title: "SDK session" },
    ]);
  });

  it("dispatches multiple converters registered for one upstream event", () => {
    expect(convertEvent(sdkUserMessage(), "/repo")).toEqual([
      { ...deterministicBase, event_type: "message.updated.user", message_id: "msg_user_1", session_id: "ses_1", project_path: "/repo", role: "user", agent: "coder", lines_added: 0, lines_deleted: 0, files_changed: 0, created_at_ms: 3_000 },
    ]);
  });

  it("auto-registers tool part converters", () => {
    expect(convertEvent(sdkToolCompleted(), "/repo")[0]).toMatchObject({
      event_type: "tool.execute.completed",
      duration_ms: 1_000,
      title: "listed files",
    });
  });

  it("allows registering additional converters for an existing event type", () => {
    registerConverter("session.created", () => [sessionCreated({ event_id: "extra_evt" })]);

    const converted = convertEvent(sdkSessionCreated(), "/fallback");

    expect(converted).toHaveLength(2);
    expect(converted[1]).toEqual(sessionCreated({ event_id: "extra_evt" }));
  });
});
