import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { convert, eventType } from "../../../src/event/converters/message-updated-assistant";
import { deterministicBase, installDeterministicBaseEvent, restoreBaseEventGlobals } from "../../helpers/deterministic-base-event";
import { sdkAssistantMessage, sdkUserMessage } from "../../helpers/sdk-events";

describe("message-updated-assistant converter", () => {
  beforeEach(installDeterministicBaseEvent);
  afterEach(restoreBaseEventGlobals);

  it("declares the shared upstream message event type", () => {
    expect(eventType).toBe("message.updated");
  });

  it("maps assistant token, model, cost and duration fields", () => {
    expect(convert(sdkAssistantMessage(), "/repo")).toEqual([
      { ...deterministicBase, event_type: "message.updated.assistant", message_id: "msg_assistant_1", session_id: "ses_1", project_path: "/repo", model: "openai/gpt-4", agent: "build", tokens: { input: 100, output: 50, reasoning: 10, cache: { read: 5, write: 5 } }, cost_usd: 0.25, created_at_ms: 4_000, completed_at_ms: 4_900, duration_ms: 900, finish_reason: "stop", has_error: 0, error_type: undefined },
    ]);
  });

  it("marks assistant messages with errors", () => {
    expect(convert(sdkAssistantMessage({ error: { name: "UnknownError", data: { message: "bad" } } }), "/repo")[0]).toMatchObject({
      has_error: 1,
      error_type: "UnknownError",
    });
  });

  it("returns no events for user messages", () => {
    expect(convert(sdkUserMessage(), "/repo")).toEqual([]);
  });
});
