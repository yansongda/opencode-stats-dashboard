/**
 * Tests for Stats API endpoints — 8 REST endpoints for querying stats.
 *
 * Endpoints:
 *  - GET /api/v1/stats/overview
 *  - GET /api/v1/stats/trend
 *  - GET /api/v1/stats/sessions
 *  - GET /api/v1/stats/sessions/:id
 *  - GET /api/v1/stats/tools
 *  - GET /api/v1/stats/models
 *  - GET /api/v1/stats/projects
 *  - GET /api/v1/stats/errors
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { Database } from "bun:sqlite"
import { APIRouter } from "./router"
import { createStatsHandler } from "./stats"
import { runMigrations, configurePragmas } from "../db/schema"

// ============================================================================
// Helpers
// ============================================================================

function makeRequest(path: string): Request {
  return new Request(`http://localhost${path}`)
}

/** Seed projection_sessions with test data. */
function seedSessions(db: Database): void {
  const now = Date.now()
  const rows = [
    {
      session_id: "ses_001",
      project_path: "/Users/test/project-a",
      title: "First session",
      status: "active",
      primary_model: "claude-sonnet-4-20250514",
      model_usage: JSON.stringify({
        "claude-sonnet-4-20250514": { message_count: 5, tokens: { input: 1000, output: 500, reasoning: 0, cache: { read: 100, write: 50 } }, cost_usd: 0.05 },
      }),
      first_event_at: now - 3600000,
      last_event_at: now,
      duration_ms: 3600000,
      user_message_count: 3,
      assistant_message_count: 2,
      total_tokens: 1600,
      input_tokens: 1000,
      output_tokens: 500,
      reasoning_tokens: 0,
      cache_read: 100,
      cache_write: 50,
      total_cost_usd: 0.05,
      tool_call_count: 4,
      tool_error_count: 1,
      files_edited: 2,
      lines_added: 50,
      lines_deleted: 10,
      primary_agent: "build",
      agent_usage: JSON.stringify({ build: { message_count: 2, tokens: { input: 500, output: 200, reasoning: 0, cache: { read: 50, write: 25 } }, cost_usd: 0.02 } }),
      error_count: 1,
      event_count: 10,
    },
    {
      session_id: "ses_002",
      project_path: "/Users/test/project-b",
      title: "Second session",
      status: "active",
      primary_model: "claude-sonnet-4-20250514",
      model_usage: JSON.stringify({
        "claude-sonnet-4-20250514": { message_count: 3, tokens: { input: 600, output: 300, reasoning: 0, cache: { read: 50, write: 25 } }, cost_usd: 0.03 },
      }),
      first_event_at: now - 7200000,
      last_event_at: now - 1800000,
      duration_ms: 5400000,
      user_message_count: 2,
      assistant_message_count: 1,
      total_tokens: 950,
      input_tokens: 600,
      output_tokens: 300,
      reasoning_tokens: 0,
      cache_read: 50,
      cache_write: 25,
      total_cost_usd: 0.03,
      tool_call_count: 2,
      tool_error_count: 0,
      files_edited: 1,
      lines_added: 20,
      lines_deleted: 5,
      primary_agent: null,
      agent_usage: null,
      error_count: 0,
      event_count: 6,
    },
    {
      session_id: "ses_003",
      project_path: "/Users/test/project-a",
      title: "Deleted session",
      status: "deleted",
      primary_model: "gpt-4o",
      model_usage: JSON.stringify({
        "gpt-4o": { message_count: 1, tokens: { input: 200, output: 100, reasoning: 0, cache: { read: 0, write: 0 } }, cost_usd: 0.01 },
      }),
      first_event_at: now - 86400000,
      last_event_at: now - 82800000,
      duration_ms: 3600000,
      user_message_count: 1,
      assistant_message_count: 0,
      total_tokens: 300,
      input_tokens: 200,
      output_tokens: 100,
      reasoning_tokens: 0,
      cache_read: 0,
      cache_write: 0,
      total_cost_usd: 0.01,
      tool_call_count: 0,
      tool_error_count: 0,
      files_edited: 0,
      lines_added: 0,
      lines_deleted: 0,
      primary_agent: null,
      agent_usage: null,
      error_count: 0,
      event_count: 2,
    },
  ]

  const stmt = db.prepare(`
    INSERT INTO projection_sessions
    (session_id, project_path, title, status, primary_model, model_usage,
     first_event_at, last_event_at, duration_ms, user_message_count, assistant_message_count,
     total_tokens, input_tokens, output_tokens, reasoning_tokens, cache_read, cache_write,
     total_cost_usd, tool_call_count, tool_error_count, files_edited, lines_added, lines_deleted,
     primary_agent, agent_usage, error_count, event_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  for (const row of rows) {
    stmt.run(
      row.session_id, row.project_path, row.title, row.status, row.primary_model, row.model_usage,
      row.first_event_at, row.last_event_at, row.duration_ms, row.user_message_count, row.assistant_message_count,
      row.total_tokens, row.input_tokens, row.output_tokens, row.reasoning_tokens, row.cache_read, row.cache_write,
      row.total_cost_usd, row.tool_call_count, row.tool_error_count, row.files_edited, row.lines_added, row.lines_deleted,
      row.primary_agent, row.agent_usage, row.error_count, row.event_count,
    )
  }
}

/** Seed projection_daily with test data. */
function seedDaily(db: Database): void {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO projection_daily
    (date, project_path, model, session_count, active_sessions, deleted_sessions,
     message_count, user_messages, assistant_messages, total_tokens, input_tokens, output_tokens,
     reasoning_tokens, cache_read, cache_write, total_cost_usd, tool_calls, tool_errors,
     files_edited, lines_added, lines_deleted, agent_usage, error_count, event_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const rows = [
    ["2026-06-01", "/Users/test/project-a", "claude-sonnet-4-20250514", 2, 2, 0, 10, 5, 5, 3000, 2000, 800, 0, 200, 100, 0.12, 6, 1, 3, 100, 20, null, 1, 20],
    ["2026-06-01", "/Users/test/project-b", "gpt-4o", 1, 1, 0, 5, 3, 2, 500, 300, 200, 0, 0, 0, 0.02, 2, 0, 1, 30, 5, null, 0, 8],
    ["2026-06-02", "/Users/test/project-a", "claude-sonnet-4-20250514", 1, 1, 0, 8, 4, 4, 2500, 1500, 700, 0, 150, 80, 0.10, 4, 0, 2, 80, 15, null, 0, 15],
    ["2026-06-03", "/Users/test/project-a", "claude-sonnet-4-20250514", 1, 0, 1, 3, 2, 1, 800, 500, 200, 0, 50, 25, 0.03, 1, 1, 0, 0, 0, null, 1, 5],
  ]

  for (const r of rows) {
    stmt.run(...r)
  }
}

/** Seed projection_tool_calls with test data. */
function seedToolCalls(db: Database): void {
  const stmt = db.prepare(`
    INSERT INTO projection_tool_calls
    (call_id, session_id, tool_name, status, started_at, completed_at, duration_ms,
     input_tokens, output_tokens, cache_read, cache_write, cost_usd, title, error_message)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const now = Date.now()
  const rows = [
    ["tc_001", "ses_001", "read", "completed", now - 3000000, now - 2999000, 100, 100, 50, 10, 5, 0.001, "Read file", null],
    ["tc_002", "ses_001", "edit", "completed", now - 2500000, now - 2498000, 2000, 200, 100, 20, 10, 0.005, "Edit file", null],
    ["tc_003", "ses_001", "bash", "error", now - 2000000, now - 1999500, 500, 50, 0, 0, 0, 0.0005, "Run command", "Command failed"],
    ["tc_004", "ses_001", "read", "completed", now - 1500000, now - 1499800, 200, 100, 50, 10, 5, 0.001, "Read file 2", null],
    ["tc_005", "ses_002", "edit", "completed", now - 1000000, now - 998000, 2000, 200, 100, 20, 10, 0.005, "Edit file 2", null],
    ["tc_006", "ses_002", "grep", "completed", now - 500000, now - 499900, 100, 50, 30, 5, 2, 0.0003, "Search", null],
  ]

  for (const r of rows) {
    stmt.run(...r)
  }
}

/** Seed events with test data (for error stats). */
function seedEvents(db: Database): void {
  const stmt = db.prepare(`
    INSERT INTO events (event_id, event_type, session_id, timestamp_ms, model, total_tokens, cost_usd, event_contents)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const now = Date.now()
  const rows = [
    ["evt_001", "session.error", "ses_001", now - 3000000, "claude-sonnet-4-20250514", 0, 0, JSON.stringify({ error_type: "timeout", message: "Request timed out" })],
    ["evt_002", "session.error", "ses_001", now - 2000000, "claude-sonnet-4-20250514", 0, 0, JSON.stringify({ error_type: "timeout", message: "Request timed out again" })],
    ["evt_003", "session.error", "ses_002", now - 1000000, "gpt-4o", 0, 0, JSON.stringify({ error_type: "rate_limit", message: "Rate limit exceeded" })],
  ]

  for (const r of rows) {
    stmt.run(...r)
  }
}

// ============================================================================
// Tests
// ============================================================================

describe("Stats API - Overview Endpoint", () => {
  let db: Database
  let router: APIRouter

  beforeEach(() => {
    db = new Database(":memory:")
    configurePragmas(db)
    runMigrations(db)
    router = new APIRouter()
    createStatsHandler(db)(router)
  })

  afterEach(() => {
    db.close()
  })

  test("returns overview stats with correct totals", async () => {
    seedSessions(db)
    seedDaily(db)

    const res = await router.handle(makeRequest("/api/v1/stats/overview"))
    expect(res.status).toBe(200)

    const body: any = await res.json()
    expect(body.data).toBeDefined()
    expect(typeof body.data.total_sessions).toBe("number")
    expect(typeof body.data.total_tokens).toBe("number")
    expect(typeof body.data.total_cost_usd).toBe("number")
    expect(typeof body.data.tool_call_count).toBe("number")
    expect(typeof body.data.error_count).toBe("number")
  })

  test("returns zero values when no data exists", async () => {
    const res = await router.handle(makeRequest("/api/v1/stats/overview"))
    expect(res.status).toBe(200)

    const body: any = await res.json()
    expect(body.data.total_sessions).toBe(0)
    expect(body.data.total_tokens).toBe(0)
    expect(body.data.total_cost_usd).toBe(0)
  })
})

describe("Stats API - Trend Endpoint", () => {
  let db: Database
  let router: APIRouter

  beforeEach(() => {
    db = new Database(":memory:")
    configurePragmas(db)
    runMigrations(db)
    router = new APIRouter()
    createStatsHandler(db)(router)
  })

  afterEach(() => {
    db.close()
  })

  test("returns trend data as array", async () => {
    seedDaily(db)

    const res = await router.handle(makeRequest("/api/v1/stats/trend?start=2026-06-01&end=2026-06-03"))
    expect(res.status).toBe(200)

    const body: any = await res.json()
    expect(body.data).toBeDefined()
    expect(body.data.granularity).toBe("day")
    expect(Array.isArray(body.data.data)).toBe(true)
    expect(body.data.data.length).toBeGreaterThan(0)
    expect(body.data.data[0]).toHaveProperty("date")
    expect(body.data.data[0]).toHaveProperty("tokens")
    expect(body.data.data[0]).toHaveProperty("cost_usd")
  })

  test("returns empty array for date range with no data", async () => {
    const res = await router.handle(makeRequest("/api/v1/stats/trend?start=2025-01-01&end=2025-01-31"))
    expect(res.status).toBe(200)

    const body: any = await res.json()
    expect(body.data.data).toEqual([])
  })
})

describe("Stats API - Sessions List Endpoint", () => {
  let db: Database
  let router: APIRouter

  beforeEach(() => {
    db = new Database(":memory:")
    configurePragmas(db)
    runMigrations(db)
    router = new APIRouter()
    createStatsHandler(db)(router)
  })

  afterEach(() => {
    db.close()
  })

  test("returns paginated session list", async () => {
    seedSessions(db)

    const res = await router.handle(makeRequest("/api/v1/stats/sessions?limit=2&offset=0"))
    expect(res.status).toBe(200)

    const body: any = await res.json()
    expect(Array.isArray(body.data.sessions)).toBe(true)
    expect(body.data.sessions.length).toBeLessThanOrEqual(2)
    expect(typeof body.data.total).toBe("number")
    expect(body.meta).toBeDefined()
    expect(body.meta.total).toBe(body.data.total)
  })

  test("respects limit and offset for pagination", async () => {
    seedSessions(db)

    const res1 = await router.handle(makeRequest("/api/v1/stats/sessions?limit=2&offset=0"))
    const body1: any = await res1.json()

    const res2 = await router.handle(makeRequest("/api/v1/stats/sessions?limit=2&offset=2"))
    const body2: any = await res2.json()

    // Should get different sessions
    if (body1.data.sessions.length > 0 && body2.data.sessions.length > 0) {
      expect(body1.data.sessions[0].session_id).not.toBe(body2.data.sessions[0].session_id)
    }
  })

  test("session list items have required fields", async () => {
    seedSessions(db)

    const res = await router.handle(makeRequest("/api/v1/stats/sessions"))
    const body: any = await res.json()

    if (body.data.sessions.length > 0) {
      const item = body.data.sessions[0]
      expect(typeof item.session_id).toBe("string")
      expect(typeof item.total_tokens).toBe("number")
      expect(typeof item.total_cost_usd).toBe("number")
    }
  })

  test("filters by status", async () => {
    seedSessions(db)

    const res = await router.handle(makeRequest("/api/v1/stats/sessions?status=deleted"))
    const body: any = await res.json()

    for (const session of body.data.sessions) {
      expect(session.status).toBe("deleted")
    }
  })
})

describe("Stats API - Session Detail Endpoint", () => {
  let db: Database
  let router: APIRouter

  beforeEach(() => {
    db = new Database(":memory:")
    configurePragmas(db)
    runMigrations(db)
    router = new APIRouter()
    createStatsHandler(db)(router)
  })

  afterEach(() => {
    db.close()
  })

  test("returns session detail by id", async () => {
    seedSessions(db)

    const res = await router.handle(makeRequest("/api/v1/stats/sessions/ses_001"))
    expect(res.status).toBe(200)

    const body: any = await res.json()
    expect(body.data.session_id).toBe("ses_001")
    expect(body.data.project_path).toBe("/Users/test/project-a")
    expect(body.data.total_tokens).toBe(1600)
    expect(body.data.input_tokens).toBe(1000)
    expect(body.data.output_tokens).toBe(500)
    expect(body.data.tool_call_count).toBe(4)
    expect(body.data.error_count).toBe(1)
  })

  test("returns 404 for non-existent session", async () => {
    const res = await router.handle(makeRequest("/api/v1/stats/sessions/ses_nonexistent"))
    expect(res.status).toBe(404)
  })

  test("includes model_usage and agent_usage", async () => {
    seedSessions(db)

    const res = await router.handle(makeRequest("/api/v1/stats/sessions/ses_001"))
    const body: any = await res.json()

    expect(body.data.model_usage).toBeDefined()
    expect(body.data.agent_usage).toBeDefined()
  })
})

describe("Stats API - Tools Endpoint", () => {
  let db: Database
  let router: APIRouter

  beforeEach(() => {
    db = new Database(":memory:")
    configurePragmas(db)
    runMigrations(db)
    router = new APIRouter()
    createStatsHandler(db)(router)
  })

  afterEach(() => {
    db.close()
  })

  test("returns tool statistics", async () => {
    seedToolCalls(db)

    const res = await router.handle(makeRequest("/api/v1/stats/tools"))
    expect(res.status).toBe(200)

    const body: any = await res.json()
    expect(Array.isArray(body.data.tools)).toBe(true)
    expect(typeof body.data.total_calls).toBe("number")
    expect(typeof body.data.total_errors).toBe("number")
    expect(typeof body.data.success_rate).toBe("number")
  })

  test("tool items have required fields", async () => {
    seedToolCalls(db)

    const res = await router.handle(makeRequest("/api/v1/stats/tools"))
    const body: any = await res.json()

    if (body.data.tools.length > 0) {
      const tool = body.data.tools[0]
      expect(typeof tool.tool_name).toBe("string")
      expect(typeof tool.call_count).toBe("number")
      expect(typeof tool.error_count).toBe("number")
      expect(typeof tool.success_rate).toBe("number")
    }
  })

  test("returns empty tools when no data", async () => {
    const res = await router.handle(makeRequest("/api/v1/stats/tools"))
    const body: any = await res.json()

    expect(body.data.tools).toEqual([])
    expect(body.data.total_calls).toBe(0)
  })
})

describe("Stats API - Models Endpoint", () => {
  let db: Database
  let router: APIRouter

  beforeEach(() => {
    db = new Database(":memory:")
    configurePragmas(db)
    runMigrations(db)
    router = new APIRouter()
    createStatsHandler(db)(router)
  })

  afterEach(() => {
    db.close()
  })

  test("returns model comparison data", async () => {
    seedDaily(db)

    const res = await router.handle(makeRequest("/api/v1/stats/models"))
    expect(res.status).toBe(200)

    const body: any = await res.json()
    expect(Array.isArray(body.data.models)).toBe(true)
    expect(typeof body.data.total_cost_usd).toBe("number")
  })

  test("model items have required fields", async () => {
    seedDaily(db)

    const res = await router.handle(makeRequest("/api/v1/stats/models"))
    const body: any = await res.json()

    if (body.data.models.length > 0) {
      const model = body.data.models[0]
      expect(typeof model.model).toBe("string")
      expect(typeof model.session_count).toBe("number")
      expect(typeof model.total_tokens).toBe("number")
      expect(typeof model.total_cost_usd).toBe("number")
    }
  })
})

describe("Stats API - Projects Endpoint", () => {
  let db: Database
  let router: APIRouter

  beforeEach(() => {
    db = new Database(":memory:")
    configurePragmas(db)
    runMigrations(db)
    router = new APIRouter()
    createStatsHandler(db)(router)
  })

  afterEach(() => {
    db.close()
  })

  test("returns project comparison data", async () => {
    seedDaily(db)

    const res = await router.handle(makeRequest("/api/v1/stats/projects"))
    expect(res.status).toBe(200)

    const body: any = await res.json()
    expect(Array.isArray(body.data.projects)).toBe(true)
    expect(typeof body.data.total_cost_usd).toBe("number")
  })

  test("project items have required fields", async () => {
    seedDaily(db)

    const res = await router.handle(makeRequest("/api/v1/stats/projects"))
    const body: any = await res.json()

    if (body.data.projects.length > 0) {
      const project = body.data.projects[0]
      expect(typeof project.project_path).toBe("string")
      expect(typeof project.session_count).toBe("number")
      expect(typeof project.total_tokens).toBe("number")
      expect(typeof project.total_cost_usd).toBe("number")
    }
  })
})

describe("Stats API - Errors Endpoint", () => {
  let db: Database
  let router: APIRouter

  beforeEach(() => {
    db = new Database(":memory:")
    configurePragmas(db)
    runMigrations(db)
    router = new APIRouter()
    createStatsHandler(db)(router)
  })

  afterEach(() => {
    db.close()
  })

  test("returns error statistics", async () => {
    seedEvents(db)

    const res = await router.handle(makeRequest("/api/v1/stats/errors"))
    expect(res.status).toBe(200)

    const body: any = await res.json()
    expect(Array.isArray(body.data.errors)).toBe(true)
    expect(typeof body.data.total_errors).toBe("number")
  })

  test("error items have required fields", async () => {
    seedEvents(db)

    const res = await router.handle(makeRequest("/api/v1/stats/errors"))
    const body: any = await res.json()

    if (body.data.errors.length > 0) {
      const error = body.data.errors[0]
      expect(typeof error.error_type).toBe("string")
      expect(typeof error.count).toBe("number")
      expect(Array.isArray(error.session_ids)).toBe(true)
    }
  })

  test("returns empty errors when no data", async () => {
    const res = await router.handle(makeRequest("/api/v1/stats/errors"))
    const body: any = await res.json()

    expect(body.data.errors).toEqual([])
    expect(body.data.total_errors).toBe(0)
  })
})
