import type {
  EventMessagePartUpdated,
  EventMessageUpdated,
  EventSessionCreated,
  EventSessionDeleted,
  EventSessionError,
  EventSessionUpdated,
} from "@opencode-ai/sdk";

type SessionInfo = EventSessionCreated["properties"]["info"];
type MessageInfo = EventMessageUpdated["properties"]["info"];
type ToolPart = Extract<EventMessagePartUpdated["properties"]["part"], { type: "tool" }>;
type ToolState = ToolPart["state"];

export function sdkSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: "ses_1",
    projectID: "proj_1",
    directory: "/sdk-repo",
    title: "SDK session",
    version: "1.0.0",
    time: { created: 1_000, updated: 2_000, ...overrides.time },
    ...overrides,
  } satisfies SessionInfo;
}

export function sdkSessionCreated(overrides: Partial<SessionInfo> = {}): EventSessionCreated {
  return { type: "session.created", properties: { info: sdkSession(overrides) } };
}

export function sdkSessionUpdated(overrides: Partial<SessionInfo> = {}): EventSessionUpdated {
  return { type: "session.updated", properties: { info: sdkSession(overrides) } };
}

export function sdkSessionDeleted(overrides: Partial<SessionInfo> = {}): EventSessionDeleted {
  return { type: "session.deleted", properties: { info: sdkSession(overrides) } };
}

export function sdkSessionError(
  overrides: Partial<EventSessionError["properties"]> = {},
): EventSessionError {
  return {
    type: "session.error",
    properties: {
      sessionID: "ses_1",
      error: { name: "UnknownError", data: { message: "session exploded" } },
      ...overrides,
    },
  };
}

export function sdkUserMessage(overrides: Partial<Extract<MessageInfo, { role: "user" }>> = {}): EventMessageUpdated {
  const base = {
    id: "msg_user_1",
    sessionID: "ses_1",
    role: "user" as const,
    time: { created: 3_000, ...overrides.time },
    agent: "coder",
    model: { providerID: "anthropic", modelID: "claude" },
    ...overrides,
  } satisfies Extract<MessageInfo, { role: "user" }>;

  return { type: "message.updated", properties: { info: base } };
}

export function sdkAssistantMessage(
  overrides: Partial<Extract<MessageInfo, { role: "assistant" }>> = {},
): EventMessageUpdated {
  const base = {
    id: "msg_assistant_1",
    sessionID: "ses_1",
    role: "assistant" as const,
    time: { created: 4_000, completed: 4_900, ...overrides.time },
    parentID: "msg_user_1",
    modelID: "gpt-4",
    providerID: "openai",
    mode: "build",
    path: { cwd: "/sdk-repo", root: "/sdk-repo" },
    cost: 0.25,
    tokens: { input: 100, output: 50, reasoning: 10, cache: { read: 5, write: 5 } },
    finish: "stop",
    ...overrides,
  } satisfies Extract<MessageInfo, { role: "assistant" }>;

  return { type: "message.updated", properties: { info: base } };
}

function sdkToolPart(state: ToolState, overrides: Partial<Omit<ToolPart, "type" | "state">> = {}): ToolPart {
  return {
    id: "part_1",
    sessionID: "ses_1",
    messageID: "msg_assistant_1",
    type: "tool",
    callID: "call_1",
    tool: "bash",
    state,
    ...overrides,
  } satisfies ToolPart;
}

export function sdkToolPending(overrides: Partial<Omit<ToolPart, "type" | "state">> = {}): EventMessagePartUpdated {
  return {
    type: "message.part.updated",
    properties: { part: sdkToolPart({ status: "pending", input: {}, raw: "{}" }, overrides) },
  };
}

export function sdkToolRunning(overrides: Partial<Omit<ToolPart, "type" | "state">> = {}): EventMessagePartUpdated {
  return {
    type: "message.part.updated",
    properties: { part: sdkToolPart({ status: "running", input: {}, time: { start: 7_000 } }, overrides) },
  };
}

export function sdkToolCompleted(overrides: Partial<Omit<ToolPart, "type" | "state">> = {}): EventMessagePartUpdated {
  return {
    type: "message.part.updated",
    properties: {
      part: sdkToolPart(
        { status: "completed", input: {}, output: "ok", title: "listed files", metadata: {}, time: { start: 7_000, end: 8_000 } },
        overrides,
      ),
    },
  };
}

export function sdkToolFailed(overrides: Partial<Omit<ToolPart, "type" | "state">> = {}): EventMessagePartUpdated {
  return {
    type: "message.part.updated",
    properties: {
      part: sdkToolPart(
        { status: "error", input: {}, error: "command failed", time: { start: 7_000, end: 8_500 } },
        overrides,
      ),
    },
  };
}
