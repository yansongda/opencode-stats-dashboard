/**
 * Type definitions tests for the Event-Sourced Stats Engine.
 *
 * Tests type compatibility, JSON serialization/deserialization,
 * and type guard validation.
 */

import { describe, expect, test } from "bun:test"
import type {
  EventType,
  IngestEventEnvelope,
  TokenBreakdown,
  SessionCreatedContents,
  SessionUpdatedContents,
  SessionDeletedContents,
  SessionErrorContents,
  SessionDiffContents,
  MessageCreatedContents,
  MessageUpdatedContents,
  MessageDeletedContents,
  ToolStartedContents,
  ToolCompletedContents,
  ToolFailedContents,
  ToolExecuteBeforeContents,
  ToolExecuteAfterContents,
  FileCreatedContents,
  FileEditedContents,
  FileDeletedContents,
  PermissionCreatedContents,
  PermissionUpdatedContents,
  PermissionResolvedContents,
  UsageUpdatedContents,
  AgentStartedContents,
  AgentCompletedContents,
  AgentFailedContents,
  ProviderConnectedContents,
  ProviderDisconnectedContents,
  ProviderErrorContents,
  ConfigUpdatedContents,
  ProjectCreatedContents,
  ProjectDeletedContents,
  SystemStartedContents,
  ProjectionSession,
  ProjectionDaily,
  ProjectionToolCall,
  SnapshotRecord,
  SessionSnapshotData,
  DailySnapshotData,
  WeeklySnapshotData,
  MonthlySnapshotData,
  StatsUpdate,
  SSEDelta,
  OverviewStats,
  TrendResponse,
  SessionsListResponse,
  SessionDetail,
  ToolsStatsResponse,
  ModelsComparisonResponse,
  ProjectsStatsResponse,
  ErrorsStatsResponse,
} from "../types/index"
import {
  isSessionCreatedContents,
  isSessionUpdatedContents,
  isSessionDeletedContents,
  isSessionErrorContents,
  isSessionDiffContents,
  isMessageCreatedContents,
  isMessageUpdatedContents,
  isMessageDeletedContents,
  isToolStartedContents,
  isToolCompletedContents,
  isToolFailedContents,
  isToolExecuteBeforeContents,
  isToolExecuteAfterContents,
  isFileCreatedContents,
  isFileEditedContents,
  isFileDeletedContents,
  isPermissionCreatedContents,
  isPermissionUpdatedContents,
  isPermissionResolvedContents,
  isUsageUpdatedContents,
  isAgentStartedContents,
  isAgentCompletedContents,
  isAgentFailedContents,
  isProviderConnectedContents,
  isProviderDisconnectedContents,
  isProviderErrorContents,
  isConfigUpdatedContents,
  isProjectCreatedContents,
  isProjectDeletedContents,
  isSystemStartedContents,
  isSessionSnapshotData,
  isDailySnapshotData,
  isWeeklySnapshotData,
  isMonthlySnapshotData,
  isStatsUpdate,
  isSSEDelta,
  generateSessionSnapshotId,
  generateDailySnapshotId,
  generateWeeklySnapshotId,
  generateMonthlySnapshotId,
  FORBIDDEN_METADATA_KEYS,
  SSE_EVENT_NAME,
  SSE_KEEPALIVE,
} from "../types/index"

// ============================================================================
// Event Type Tests
// ============================================================================

describe("Event Types", () => {
  test("EventType union contains 30 event types", () => {
    const eventTypes: EventType[] = [
      // Session events (5)
      "session.created",
      "session.updated",
      "session.deleted",
      "session.error",
      "session.diff",
      // Message events (3)
      "message.created",
      "message.updated",
      "message.deleted",
      // Tool events (5)
      "tool.started",
      "tool.completed",
      "tool.failed",
      "tool.execute.before",
      "tool.execute.after",
      // File events (3)
      "file.created",
      "file.edited",
      "file.deleted",
      // Permission events (3)
      "permission.created",
      "permission.updated",
      "permission.resolved",
      // Usage events (1)
      "usage.updated",
      // Agent events (3)
      "agent.started",
      "agent.completed",
      "agent.failed",
      // Provider events (3)
      "provider.connected",
      "provider.disconnected",
      "provider.error",
      // Config events (1)
      "config.updated",
      // Project events (2)
      "project.created",
      "project.deleted",
      // System events (1)
      "system.started",
    ]

    expect(eventTypes.length).toBe(30)
  })

  test("IngestEventEnvelope has all required fields", () => {
    const envelope: IngestEventEnvelope = {
      event_id: "test-id",
      event_type: "session.created",
      session_id: "session-123",
      project_path: "/path/to/project",
      timestamp_ms: Date.now(),
      model: "claude-sonnet-4-20250514",
      tokens: 1000,
      cost_usd: 0.01,
      tool: null,
      status: null,
      summary: null,
      deleted: false,
      metadata: {},
    }

    expect(envelope.event_id).toBe("test-id")
    expect(envelope.event_type).toBe("session.created")
  })

  test("TokenBreakdown has correct structure", () => {
    const tokens: TokenBreakdown = {
      input: 100,
      output: 50,
      reasoning: 20,
      cache: {
        read: 30,
        write: 10,
      },
    }

    expect(tokens.input).toBe(100)
    expect(tokens.cache.read).toBe(30)
  })
})

// ============================================================================
// Event Contents Tests
// ============================================================================

describe("Event Contents", () => {
  test("SessionCreatedContents type guard", () => {
    const valid = { project_path: "/path", title: "Test" }
    const invalid = { project_path: 123 }

    expect(isSessionCreatedContents(valid)).toBe(true)
    expect(isSessionCreatedContents(invalid)).toBe(false)
    expect(isSessionCreatedContents(null)).toBe(false)
  })

  test("SessionUpdatedContents type guard", () => {
    const valid = { title: "Updated" }
    const valid2 = { project_path: "/new/path" }

    expect(isSessionUpdatedContents(valid)).toBe(true)
    expect(isSessionUpdatedContents(valid2)).toBe(true)
    expect(isSessionUpdatedContents({})).toBe(false)
  })

  test("SessionDeletedContents type guard", () => {
    const valid = {}
    const valid2 = { summary: { total_messages: 10 } }

    expect(isSessionDeletedContents(valid)).toBe(true)
    expect(isSessionDeletedContents(valid2)).toBe(true)
    expect(isSessionDeletedContents(null)).toBe(false)
  })

  test("SessionErrorContents type guard", () => {
    const valid = { error_type: "AuthError", error_message: "Failed" }
    const invalid = { error_type: "AuthError" }

    expect(isSessionErrorContents(valid)).toBe(true)
    expect(isSessionErrorContents(invalid)).toBe(false)
  })

  test("SessionDiffContents type guard", () => {
    const valid = { files_changed: 5, lines_added: 100, lines_deleted: 20 }
    const invalid = { files_changed: 5 }

    expect(isSessionDiffContents(valid)).toBe(true)
    expect(isSessionDiffContents(invalid)).toBe(false)
  })

  test("MessageCreatedContents type guard", () => {
    const valid = { message_id: "msg-123", role: "assistant" as const }
    const invalid = { message_id: "msg-123" }

    expect(isMessageCreatedContents(valid)).toBe(true)
    expect(isMessageCreatedContents(invalid)).toBe(false)
  })

  test("MessageUpdatedContents type guard", () => {
    const valid = { message_id: "msg-123", role: "user" as const }
    const invalid = { message_id: "msg-123" }

    expect(isMessageUpdatedContents(valid)).toBe(true)
    expect(isMessageUpdatedContents(invalid)).toBe(false)
  })

  test("MessageDeletedContents type guard", () => {
    const valid = { message_id: "msg-123" }
    const invalid = {}

    expect(isMessageDeletedContents(valid)).toBe(true)
    expect(isMessageDeletedContents(invalid)).toBe(false)
  })

  test("ToolStartedContents type guard", () => {
    const valid = { tool_name: "bash", call_id: "call-123" }
    const invalid = { tool_name: "bash" }

    expect(isToolStartedContents(valid)).toBe(true)
    expect(isToolStartedContents(invalid)).toBe(false)
  })

  test("ToolCompletedContents type guard", () => {
    const valid = { tool_name: "bash", call_id: "call-123" }
    const invalid = { tool_name: "bash" }

    expect(isToolCompletedContents(valid)).toBe(true)
    expect(isToolCompletedContents(invalid)).toBe(false)
  })

  test("ToolFailedContents type guard", () => {
    const valid = {
      tool_name: "bash",
      call_id: "call-123",
      error_message: "Command failed",
    }
    const invalid = { tool_name: "bash", call_id: "call-123" }

    expect(isToolFailedContents(valid)).toBe(true)
    expect(isToolFailedContents(invalid)).toBe(false)
  })

  test("ToolExecuteBeforeContents type guard", () => {
    const valid = { tool_name: "bash", call_id: "call-123" }
    const invalid = { tool_name: "bash" }

    expect(isToolExecuteBeforeContents(valid)).toBe(true)
    expect(isToolExecuteBeforeContents(invalid)).toBe(false)
  })

  test("ToolExecuteAfterContents type guard", () => {
    const valid = {
      tool_name: "bash",
      call_id: "call-123",
      status: "completed" as const,
    }
    const invalid = { tool_name: "bash", call_id: "call-123" }

    expect(isToolExecuteAfterContents(valid)).toBe(true)
    expect(isToolExecuteAfterContents(invalid)).toBe(false)
  })

  test("FileCreatedContents type guard", () => {
    const valid = { file_path: "src/index.ts" }
    const invalid = {}

    expect(isFileCreatedContents(valid)).toBe(true)
    expect(isFileCreatedContents(invalid)).toBe(false)
  })

  test("FileEditedContents type guard", () => {
    const valid = { file_path: "src/index.ts", additions: 10, deletions: 5 }
    const invalid = { file_path: "src/index.ts" }

    expect(isFileEditedContents(valid)).toBe(true)
    expect(isFileEditedContents(invalid)).toBe(false)
  })

  test("FileDeletedContents type guard", () => {
    const valid = { file_path: "src/old.ts" }
    const invalid = {}

    expect(isFileDeletedContents(valid)).toBe(true)
    expect(isFileDeletedContents(invalid)).toBe(false)
  })

  test("PermissionCreatedContents type guard", () => {
    const valid = {
      permission_id: "perm-123",
      permission_type: "bash",
      pattern: "npm install",
    }
    const invalid = { permission_id: "perm-123" }

    expect(isPermissionCreatedContents(valid)).toBe(true)
    expect(isPermissionCreatedContents(invalid)).toBe(false)
  })

  test("PermissionUpdatedContents type guard", () => {
    const valid = {
      permission_id: "perm-123",
      permission_type: "bash",
      pattern: "npm install",
    }
    const invalid = { permission_id: "perm-123" }

    expect(isPermissionUpdatedContents(valid)).toBe(true)
    expect(isPermissionUpdatedContents(invalid)).toBe(false)
  })

  test("PermissionResolvedContents type guard", () => {
    const valid = {
      permission_id: "perm-123",
      permission_type: "bash",
      pattern: "npm install",
      response: "allow" as const,
    }
    const invalid = { permission_id: "perm-123" }

    expect(isPermissionResolvedContents(valid)).toBe(true)
    expect(isPermissionResolvedContents(invalid)).toBe(false)
  })

  test("UsageUpdatedContents type guard", () => {
    const valid = {
      tokens: { input: 100, output: 50, reasoning: 20, cache: { read: 30, write: 10 } },
      cost_usd: 0.01,
    }
    const invalid = { tokens: {} }

    expect(isUsageUpdatedContents(valid)).toBe(true)
    expect(isUsageUpdatedContents(invalid)).toBe(false)
  })

  test("AgentStartedContents type guard", () => {
    const valid = { agent_name: "build" }
    const invalid = {}

    expect(isAgentStartedContents(valid)).toBe(true)
    expect(isAgentStartedContents(invalid)).toBe(false)
  })

  test("AgentCompletedContents type guard", () => {
    const valid = { agent_name: "build" }
    const invalid = {}

    expect(isAgentCompletedContents(valid)).toBe(true)
    expect(isAgentCompletedContents(invalid)).toBe(false)
  })

  test("AgentFailedContents type guard", () => {
    const valid = { agent_name: "build", error_message: "Failed" }
    const invalid = { agent_name: "build" }

    expect(isAgentFailedContents(valid)).toBe(true)
    expect(isAgentFailedContents(invalid)).toBe(false)
  })

  test("ProviderConnectedContents type guard", () => {
    const valid = { provider_name: "anthropic" }
    const invalid = {}

    expect(isProviderConnectedContents(valid)).toBe(true)
    expect(isProviderConnectedContents(invalid)).toBe(false)
  })

  test("ProviderDisconnectedContents type guard", () => {
    const valid = { provider_name: "anthropic" }
    const invalid = {}

    expect(isProviderDisconnectedContents(valid)).toBe(true)
    expect(isProviderDisconnectedContents(invalid)).toBe(false)
  })

  test("ProviderErrorContents type guard", () => {
    const valid = {
      provider_name: "anthropic",
      error_type: "AuthError",
      error_message: "Invalid API key",
    }
    const invalid = { provider_name: "anthropic" }

    expect(isProviderErrorContents(valid)).toBe(true)
    expect(isProviderErrorContents(invalid)).toBe(false)
  })

  test("ConfigUpdatedContents type guard", () => {
    const valid = { config_path: "opencode.json" }
    const invalid = {}

    expect(isConfigUpdatedContents(valid)).toBe(true)
    expect(isConfigUpdatedContents(invalid)).toBe(false)
  })

  test("ProjectCreatedContents type guard", () => {
    const valid = { project_path: "/path/to/project" }
    const invalid = {}

    expect(isProjectCreatedContents(valid)).toBe(true)
    expect(isProjectCreatedContents(invalid)).toBe(false)
  })

  test("ProjectDeletedContents type guard", () => {
    const valid = { project_path: "/path/to/project" }
    const invalid = {}

    expect(isProjectDeletedContents(valid)).toBe(true)
    expect(isProjectDeletedContents(invalid)).toBe(false)
  })

  test("SystemStartedContents type guard", () => {
    const valid = {}
    const valid2 = { version: "1.0.0" }

    expect(isSystemStartedContents(valid)).toBe(true)
    expect(isSystemStartedContents(valid2)).toBe(true)
    expect(isSystemStartedContents(null)).toBe(false)
  })
})

// ============================================================================
// JSON Serialization Tests
// ============================================================================

describe("JSON Serialization", () => {
  test("SessionCreatedContents serializes and deserializes", () => {
    const original: SessionCreatedContents = {
      project_path: "/path/to/project",
      title: "Test Session",
      version: "1.0.0",
    }

    const json = JSON.stringify(original)
    const parsed = JSON.parse(json) as SessionCreatedContents

    expect(parsed.project_path).toBe(original.project_path)
    expect(parsed.title).toBe(original.title)
    expect(parsed.version).toBe(original.version)
    expect(isSessionCreatedContents(parsed)).toBe(true)
  })

  test("TokenBreakdown serializes and deserializes", () => {
    const original: TokenBreakdown = {
      input: 1000,
      output: 500,
      reasoning: 200,
      cache: {
        read: 300,
        write: 100,
      },
    }

    const json = JSON.stringify(original)
    const parsed = JSON.parse(json) as TokenBreakdown

    expect(parsed.input).toBe(original.input)
    expect(parsed.output).toBe(original.output)
    expect(parsed.reasoning).toBe(original.reasoning)
    expect(parsed.cache.read).toBe(original.cache.read)
    expect(parsed.cache.write).toBe(original.cache.write)
  })

  test("IngestEventEnvelope serializes and deserializes", () => {
    const original: IngestEventEnvelope = {
      event_id: "evt-123",
      event_type: "session.created",
      session_id: "session-456",
      project_path: "/path/to/project",
      timestamp_ms: 1717500000000,
      model: "claude-sonnet-4-20250514",
      tokens: 1500,
      cost_usd: 0.015,
      tool: null,
      status: null,
      summary: null,
      deleted: false,
      metadata: { key: "value" },
    }

    const json = JSON.stringify(original)
    const parsed = JSON.parse(json) as IngestEventEnvelope

    expect(parsed.event_id).toBe(original.event_id)
    expect(parsed.event_type).toBe(original.event_type)
    expect(parsed.session_id).toBe(original.session_id)
    expect(parsed.metadata["key"]).toBe("value")
  })

  test("StatsUpdate serializes and deserializes", () => {
    const original: StatsUpdate = {
      event_id: "evt-789",
      timestamp: "2026-06-05T10:30:00Z",
      type: "message",
      action: "updated",
      session_id: "session-123",
      delta: {
        tokens: 1500,
        cost_usd: 0.015,
      },
    }

    const json = JSON.stringify(original)
    const parsed = JSON.parse(json) as StatsUpdate

    expect(parsed.event_id).toBe(original.event_id)
    expect(parsed.timestamp).toBe(original.timestamp)
    expect(parsed.type).toBe(original.type)
    expect(parsed.action).toBe(original.action)
    expect(parsed.session_id).toBe(original.session_id)
    expect(parsed.delta?.tokens).toBe(1500)
    expect(parsed.delta?.cost_usd).toBe(0.015)
    expect(isStatsUpdate(parsed)).toBe(true)
  })
})

// ============================================================================
// Snapshot ID Generation Tests
// ============================================================================

describe("Snapshot ID Generation", () => {
  test("generateSessionSnapshotId", () => {
    const id = generateSessionSnapshotId("ses_abc123", 1717500000)
    expect(id).toBe("session_ses_abc123_1717500000")
  })

  test("generateDailySnapshotId", () => {
    const id = generateDailySnapshotId("2026-06-05", 1717500000)
    expect(id).toBe("daily_2026-06-05_1717500000")
  })

  test("generateWeeklySnapshotId", () => {
    const id = generateWeeklySnapshotId("2026-W23", 1717500000)
    expect(id).toBe("weekly_2026-W23_1717500000")
  })

  test("generateMonthlySnapshotId", () => {
    const id = generateMonthlySnapshotId("2026-06", 1717500000)
    expect(id).toBe("monthly_2026-06_1717500000")
  })
})

// ============================================================================
// Snapshot Type Guard Tests
// ============================================================================

describe("Snapshot Type Guards", () => {
  test("isSessionSnapshotData", () => {
    const valid: SessionSnapshotData = {
      session_id: "ses-123",
      project_path: "/path",
      title: "Test",
      status: "active",
      deleted_at: null,
      primary_model: "claude-sonnet",
      model_usage: null,
      duration_ms: null,
      user_message_count: 0,
      assistant_message_count: 0,
      total_tokens: 0,
      input_tokens: 0,
      output_tokens: 0,
      reasoning_tokens: 0,
      cache_read: 0,
      cache_write: 0,
      total_cost_usd: 0,
      tool_call_count: 0,
      tool_error_count: 0,
      files_edited: 0,
      lines_added: 0,
      lines_deleted: 0,
      primary_agent: null,
      agent_usage: null,
      error_count: 0,
    }

    expect(isSessionSnapshotData(valid)).toBe(true)
    expect(isSessionSnapshotData({})).toBe(false)
    expect(isSessionSnapshotData(null)).toBe(false)
  })

  test("isDailySnapshotData", () => {
    const valid: DailySnapshotData = {
      date: "2026-06-05",
      period_start: 1717468800,
      period_end: 1717555200,
      sessions: { total: 5, active: 4, deleted: 1 },
      messages: { total: 25, user: 10, assistant: 15 },
      tokens: {
        total: 25000,
        input: 15000,
        output: 10000,
        reasoning: 3000,
        cache: { read: 2000, write: 1000 },
        by_model: {},
      },
      cost_usd: { total: 0.25, by_model: {} },
      tools: { total_calls: 45, errors: 2, by_tool: {} },
      files: { edited: 12, lines_added: 500, lines_deleted: 100 },
      agents: {},
      errors: { total: 3, by_type: {} },
    }

    expect(isDailySnapshotData(valid)).toBe(true)
    expect(isDailySnapshotData({})).toBe(false)
  })

  test("isWeeklySnapshotData", () => {
    const valid: WeeklySnapshotData = {
      week: "2026-W23",
      period_start: 1717123200,
      period_end: 1717728000,
      total_days: 7,
      sessions: { total: 35, active: 30, deleted: 5 },
      messages: { total: 175, user: 70, assistant: 105 },
      tokens: {
        total: 175000,
        input: 105000,
        output: 70000,
        reasoning: 21000,
        cache: { read: 14000, write: 7000 },
        by_model: {},
      },
      cost_usd: { total: 1.75, by_model: {} },
      tools: { total_calls: 315, errors: 14, by_tool: {} },
      files: { edited: 84, lines_added: 3500, lines_deleted: 700 },
      agents: {},
      errors: { total: 21, by_type: {} },
    }

    expect(isWeeklySnapshotData(valid)).toBe(true)
    expect(isWeeklySnapshotData({})).toBe(false)
  })

  test("isMonthlySnapshotData", () => {
    const valid: MonthlySnapshotData = {
      month: "2026-06",
      period_start: 1717209600,
      period_end: 1719715200,
      total_days: 30,
      sessions: { total: 150, active: 130, deleted: 20 },
      messages: { total: 750, user: 300, assistant: 450 },
      tokens: {
        total: 750000,
        input: 450000,
        output: 300000,
        reasoning: 90000,
        cache: { read: 60000, write: 30000 },
        by_model: {},
      },
      cost_usd: { total: 7.5, by_model: {} },
      tools: { total_calls: 1350, errors: 60, by_tool: {} },
      files: { edited: 360, lines_added: 15000, lines_deleted: 3000 },
      agents: {},
      errors: { total: 90, by_type: {} },
    }

    expect(isMonthlySnapshotData(valid)).toBe(true)
    expect(isMonthlySnapshotData({})).toBe(false)
  })
})

// ============================================================================
// SSE Type Guard Tests
// ============================================================================

describe("SSE Type Guards", () => {
  test("isStatsUpdate", () => {
    const valid: StatsUpdate = {
      event_id: "evt-123",
      timestamp: "2026-06-05T10:30:00Z",
      type: "message",
      action: "updated",
    }

    expect(isStatsUpdate(valid)).toBe(true)
    expect(isStatsUpdate({})).toBe(false)
    expect(isStatsUpdate(null)).toBe(false)
  })

  test("isSSEDelta", () => {
    const valid = { tokens: 100, cost_usd: 0.01 }
    const empty = {}

    expect(isSSEDelta(valid)).toBe(true)
    expect(isSSEDelta(empty)).toBe(true)
    expect(isSSEDelta(null)).toBe(false)
  })
})

// ============================================================================
// Constants Tests
// ============================================================================

describe("Constants", () => {
  test("FORBIDDEN_METADATA_KEYS contains expected values", () => {
    expect(FORBIDDEN_METADATA_KEYS).toContain("tool_input")
    expect(FORBIDDEN_METADATA_KEYS).toContain("tool_output")
    expect(FORBIDDEN_METADATA_KEYS).toContain("message_body")
    expect(FORBIDDEN_METADATA_KEYS).toContain("raw_input")
    expect(FORBIDDEN_METADATA_KEYS).toContain("raw_output")
    expect(FORBIDDEN_METADATA_KEYS.length).toBe(5)
  })

  test("SSE_EVENT_NAME is correct", () => {
    expect(SSE_EVENT_NAME).toBe("stats-update")
  })

  test("SSE_KEEPALIVE is correct", () => {
    expect(SSE_KEEPALIVE).toBe(": keepalive")
  })
})

// ============================================================================
// Projection Type Tests
// ============================================================================

describe("Projection Types", () => {
  test("ProjectionSession has all required fields", () => {
    const session: ProjectionSession = {
      session_id: "ses-123",
      project_path: "/path",
      title: "Test",
      status: "active",
      deleted_at: null,
      primary_model: "claude-sonnet",
      model_usage: null,
      first_event_at: 1717500000,
      last_event_at: 1717500600,
      duration_ms: 600000,
      user_message_count: 5,
      assistant_message_count: 10,
      total_tokens: 15000,
      input_tokens: 10000,
      output_tokens: 5000,
      reasoning_tokens: 1000,
      cache_read: 2000,
      cache_write: 500,
      total_cost_usd: 0.15,
      tool_call_count: 20,
      tool_error_count: 1,
      files_edited: 3,
      lines_added: 150,
      lines_deleted: 30,
      primary_agent: "build",
      agent_usage: null,
      error_count: 1,
      projected_at: "2026-06-05T10:30:00Z",
      event_count: 35,
    }

    expect(session.session_id).toBe("ses-123")
    expect(session.status).toBe("active")
  })

  test("ProjectionDaily has all required fields", () => {
    const daily: ProjectionDaily = {
      date: "2026-06-05",
      project_path: "/path",
      model: "claude-sonnet",
      session_count: 5,
      active_sessions: 4,
      deleted_sessions: 1,
      message_count: 25,
      user_messages: 10,
      assistant_messages: 15,
      total_tokens: 25000,
      input_tokens: 15000,
      output_tokens: 10000,
      reasoning_tokens: 3000,
      cache_read: 2000,
      cache_write: 1000,
      total_cost_usd: 0.25,
      tool_calls: 45,
      tool_errors: 2,
      files_edited: 12,
      lines_added: 500,
      lines_deleted: 100,
      agent_usage: null,
      error_count: 3,
      projected_at: "2026-06-05T10:30:00Z",
      event_count: 75,
    }

    expect(daily.date).toBe("2026-06-05")
    expect(daily.model).toBe("claude-sonnet")
  })

  test("ProjectionToolCall has all required fields", () => {
    const toolCall: ProjectionToolCall = {
      call_id: "call-123",
      session_id: "ses-456",
      tool_name: "bash",
      status: "completed",
      started_at: 1717500000,
      completed_at: 1717500001,
      duration_ms: 1000,
      input_tokens: 100,
      output_tokens: 50,
      cache_read: 20,
      cache_write: 10,
      cost_usd: 0.001,
      title: "Run tests",
      error_message: null,
      projected_at: "2026-06-05T10:30:00Z",
    }

    expect(toolCall.call_id).toBe("call-123")
    expect(toolCall.status).toBe("completed")
  })
})

// ============================================================================
// API Type Tests
// ============================================================================

describe("API Types", () => {
  test("OverviewStats has all required fields", () => {
    const stats: OverviewStats = {
      total_sessions: 100,
      active_sessions: 90,
      deleted_sessions: 10,
      total_tokens: 1000000,
      input_tokens: 600000,
      output_tokens: 400000,
      reasoning_tokens: 100000,
      cache_read: 200000,
      cache_write: 50000,
      total_cost_usd: 10.0,
      tool_call_count: 500,
      tool_error_count: 10,
      files_edited: 50,
      lines_added: 2000,
      lines_deleted: 500,
      error_count: 15,
      first_event_at: 1717200000,
      last_event_at: 1717500000,
    }

    expect(stats.total_sessions).toBe(100)
    expect(stats.total_cost_usd).toBe(10.0)
  })

  test("TrendResponse has correct structure", () => {
    const trend: TrendResponse = {
      granularity: "day",
      data: [
        {
          date: "2026-06-01",
          tokens: 50000,
          cost_usd: 0.5,
          messages: 25,
          sessions: 5,
          tool_calls: 45,
          errors: 2,
        },
      ],
    }

    expect(trend.granularity).toBe("day")
    expect(trend.data.length).toBe(1)
  })
})

// ============================================================================
// SSE Type Tests
// ============================================================================

describe("SSE Types", () => {
  test("StatsUpdate has all required fields", () => {
    const update: StatsUpdate = {
      event_id: "evt-123",
      timestamp: "2026-06-05T10:30:00Z",
      type: "message",
      action: "updated",
      session_id: "ses-456",
      delta: {
        tokens: 1500,
        cost_usd: 0.015,
      },
    }

    expect(update.event_id).toBe("evt-123")
    expect(update.type).toBe("message")
    expect(update.action).toBe("updated")
    expect(update.delta?.tokens).toBe(1500)
  })

  test("SSEDelta has correct structure", () => {
    const delta: SSEDelta = {
      tokens: 100,
      cost_usd: 0.01,
      tool_calls: 5,
      errors: 1,
    }

    expect(delta.tokens).toBe(100)
    expect(delta.cost_usd).toBe(0.01)
    expect(delta.tool_calls).toBe(5)
    expect(delta.errors).toBe(1)
  })
})
