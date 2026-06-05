/**
 * QA Server — temporary server for final QA testing.
 * Starts API server on port 11133 with a fresh database.
 */

import { Database } from "bun:sqlite"
import { configurePragmas, runMigrations } from "./src/db/schema"
import { APIRouter } from "./src/api/router"
import { createStatsHandler } from "./src/api/stats"
import { registerStreamRoutes } from "./src/api/stream"
import { SSEBroadcaster } from "./src/sse/broadcaster"
import { ProjectionEngine } from "./src/projection/engine"
import { createSessionProjectionHandler } from "./src/projection/sessions"
import { DailyProjectionHandler } from "./src/projection/daily"
import { toolCallHandler } from "./src/projection/tool-calls"
import { EventStore } from "./src/store/event"
import type { IngestEventEnvelope } from "./src/types/events"

// Fresh database
const dbPath = "./qa-stats.db"
const fs = await import("fs")
try { fs.unlinkSync(dbPath) } catch {}

const db = new Database(dbPath)
configurePragmas(db)
runMigrations(db)

// Setup projection engine
const broadcaster = new SSEBroadcaster()
const projectionEngine = new ProjectionEngine(db)
const sessionHandler = createSessionProjectionHandler()
const dailyHandler = new DailyProjectionHandler(db)

projectionEngine.registerHandler("session-projection", sessionHandler)
projectionEngine.registerHandler("daily-projection", dailyHandler)
projectionEngine.registerHandler("tool-calls-projection", toolCallHandler)

const eventStore = new EventStore(db)

// Setup API router
const router = new APIRouter()
createStatsHandler(db)(router)
registerStreamRoutes(router, broadcaster)

// Insert some test data for QA
function seedTestData() {
  const now = Date.now()
  const sessions = [
    { id: "ses_qa_001", project: "/Users/test/project-alpha", model: "claude-sonnet-4-20250514", agent: "build" },
    { id: "ses_qa_002", project: "/Users/test/project-beta", model: "gpt-4o", agent: "code" },
    { id: "ses_qa_003", project: "/Users/test/project-alpha", model: "claude-sonnet-4-20250514", agent: "build" },
  ]

  for (const session of sessions) {
    // session.created
    const createdEvent: IngestEventEnvelope = {
      event_id: `evt_${session.id}_created`,
      event_type: "session.created",
      session_id: session.id,
      project_path: session.project,
      timestamp_ms: now - 3600000,
      model: session.model,
      tokens: 0,
      cost_usd: 0,
      tool: null,
      status: null,
      summary: null,
      deleted: false,
      metadata: { primary_agent: session.agent },
    }
    eventStore.insertEvent(createdEvent)
    projectionEngine.processEvent(createdEvent)

    // message.updated events
    for (let i = 0; i < 5; i++) {
      const msgEvent: IngestEventEnvelope = {
        event_id: `evt_${session.id}_msg_${i}`,
        event_type: "message.updated",
        session_id: session.id,
        project_path: session.project,
        timestamp_ms: now - 3600000 + (i * 600000),
        model: session.model,
        tokens: (100 + i * 50) + (200 + i * 100),
        cost_usd: 0.001 + i * 0.0005,
        tool: null,
        status: null,
        summary: null,
        deleted: false,
        metadata: {
          role: i % 2 === 0 ? "user" : "assistant",
          agent: session.agent,
          token_breakdown: { input: 100 + i * 50, output: 200 + i * 100, reasoning: 0, cache: { read: 0, write: 0 } },
        },
      }
      eventStore.insertEvent(msgEvent)
      projectionEngine.processEvent(msgEvent)
    }

    // tool events
    const tools = ["bash", "read", "write", "edit", "glob"]
    for (let i = 0; i < 3; i++) {
      const toolStart: IngestEventEnvelope = {
        event_id: `evt_${session.id}_tool_start_${i}`,
        event_type: "tool.started",
        session_id: session.id,
        project_path: session.project,
        timestamp_ms: now - 3600000 + (i * 1200000),
        model: session.model,
        tokens: 0,
        cost_usd: 0,
        tool: tools[i % tools.length],
        status: "started",
        summary: null,
        deleted: false,
        metadata: {},
      }
      eventStore.insertEvent(toolStart)
      projectionEngine.processEvent(toolStart)

      const toolEnd: IngestEventEnvelope = {
        event_id: `evt_${session.id}_tool_end_${i}`,
        event_type: "tool.completed",
        session_id: session.id,
        project_path: session.project,
        timestamp_ms: now - 3600000 + (i * 1200000) + 500,
        model: session.model,
        tokens: 0,
        cost_usd: 0,
        tool: tools[i % tools.length],
        status: "completed",
        summary: null,
        deleted: false,
        metadata: { duration_ms: 100 + i * 50 },
      }
      eventStore.insertEvent(toolEnd)
      projectionEngine.processEvent(toolEnd)
    }
  }
}

seedTestData()
console.log("✅ Test data seeded")

// Start server
const server = Bun.serve({
  port: 11133,
  idleTimeout: 0,
  async fetch(request) {
    return router.handle(request)
  },
})

console.log(`🚀 QA API server running on http://localhost:${server.port}`)

// Keep alive
process.on("SIGINT", () => {
  server.stop()
  db.close()
  process.exit(0)
})
