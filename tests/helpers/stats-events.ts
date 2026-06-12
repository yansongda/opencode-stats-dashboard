import type {
  MessageUpdatedAssistantEvent,
  MessageUpdatedUserEvent,
  SessionCreatedEvent,
  SessionDeletedEvent,
  SessionErrorEvent,
  SessionUpdatedEvent,
  StatsEvent,
  ToolExecuteCompletedEvent,
  ToolExecuteFailedEvent,
  ToolExecutePendingEvent,
  ToolExecuteRunningEvent,
  TokenBreakdown,
} from "../../src/types/events";

export const baseTokens: TokenBreakdown = {
  input: 10,
  output: 20,
  reasoning: 3,
  cache: { read: 4, write: 5 },
};

export function sessionCreated(overrides: Partial<SessionCreatedEvent> = {}): SessionCreatedEvent {
  return {
    event_id: "evt_session_created",
    event_type: "session.created",
    created_at_ms: 1_000,
    session_id: "ses_1",
    project_path: "/repo",
    title: "Initial title",
    ...overrides,
  };
}

export function sessionUpdated(overrides: Partial<SessionUpdatedEvent> = {}): SessionUpdatedEvent {
  return {
    event_id: "evt_session_updated",
    event_type: "session.updated",
    created_at_ms: 2_000,
    session_id: "ses_1",
    project_path: "/repo",
    title: "Updated title",
    ...overrides,
  };
}

export function sessionDeleted(overrides: Partial<SessionDeletedEvent> = {}): SessionDeletedEvent {
  return {
    event_id: "evt_session_deleted",
    event_type: "session.deleted",
    created_at_ms: 3_000,
    session_id: "ses_1",
    project_path: "/repo",
    ...overrides,
  };
}

export function sessionError(overrides: Partial<SessionErrorEvent> = {}): SessionErrorEvent {
  return {
    event_id: "evt_session_error",
    event_type: "session.error",
    created_at_ms: 4_000,
    session_id: "ses_1",
    project_path: "/repo",
    error_type: "Error",
    error_message: "boom",
    ...overrides,
  };
}

export function userMessage(overrides: Partial<MessageUpdatedUserEvent> = {}): MessageUpdatedUserEvent {
  return {
    event_id: "evt_user_message",
    event_type: "message.updated.user",
    created_at_ms: 5_000,
    message_id: "msg_user_1",
    session_id: "ses_1",
    project_path: "/repo",
    role: "user",
    agent: "coder",
    lines_added: 7,
    lines_deleted: 2,
    files_changed: 3,
    ...overrides,
  };
}

export function assistantMessage(
  overrides: Partial<MessageUpdatedAssistantEvent> = {},
): MessageUpdatedAssistantEvent {
  return {
    event_id: "evt_assistant_message",
    event_type: "message.updated.assistant",
    created_at_ms: 6_000,
    completed_at_ms: 6_900,
    duration_ms: 900,
    message_id: "msg_assistant_1",
    session_id: "ses_1",
    project_path: "/repo",
    model: "provider/model",
    agent: "build",
    tokens: baseTokens,
    cost_usd: 0.12,
    finish_reason: "stop",
    has_error: 0,
    ...overrides,
  };
}

export function toolPending(overrides: Partial<ToolExecutePendingEvent> = {}): ToolExecutePendingEvent {
  return {
    event_id: "evt_tool_pending",
    event_type: "tool.execute.pending",
    created_at_ms: 7_000,
    session_id: "ses_1",
    project_path: "/repo",
    tool_name: "bash",
    call_id: "call_1",
    ...overrides,
  };
}

export function toolRunning(overrides: Partial<ToolExecuteRunningEvent> = {}): ToolExecuteRunningEvent {
  return {
    event_id: "evt_tool_running",
    event_type: "tool.execute.running",
    created_at_ms: 7_500,
    session_id: "ses_1",
    project_path: "/repo",
    tool_name: "bash",
    call_id: "call_1",
    ...overrides,
  };
}

export function toolCompleted(overrides: Partial<ToolExecuteCompletedEvent> = {}): ToolExecuteCompletedEvent {
  return {
    event_id: "evt_tool_completed",
    event_type: "tool.execute.completed",
    created_at_ms: 8_000,
    session_id: "ses_1",
    project_path: "/repo",
    tool_name: "bash",
    call_id: "call_1",
    duration_ms: 1_000,
    title: "listed files",
    ...overrides,
  };
}

export function toolFailed(overrides: Partial<ToolExecuteFailedEvent> = {}): ToolExecuteFailedEvent {
  return {
    event_id: "evt_tool_failed",
    event_type: "tool.execute.failed",
    created_at_ms: 8_500,
    session_id: "ses_1",
    project_path: "/repo",
    tool_name: "bash",
    call_id: "call_1",
    duration_ms: 1_500,
    error_message: "failed",
    ...overrides,
  };
}

export function allStatsEvents(): StatsEvent[] {
  return [
    sessionCreated(),
    sessionUpdated(),
    sessionDeleted(),
    sessionError(),
    userMessage(),
    assistantMessage(),
    toolPending(),
    toolRunning(),
    toolCompleted(),
    toolFailed(),
  ];
}
