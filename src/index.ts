/**
 * OpenCode Stats Plugin — entry point.
 *
 * Collects events from opencode, persists them in SQLite, projects stats
 * through registered handlers, and serves them via HTTP + SSE.
 *
 * Configuration via environment variables:
 *  - STATS_PORT  (default: 11133)
 *  - STATS_DB_DIR  (default: ~/.local/share/opencode-stats-dashboard/)
 *  - STATS_DB_PATH (default: STATS_DB_DIR/stats.db)
 */

import { mkdirSync, existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve, extname } from "node:path"
import { Database } from "bun:sqlite"
import { Hono } from "hono"
import type { Plugin, PluginInput, Hooks } from "@opencode-ai/plugin"
import { configurePragmas, runMigrations } from "@db/schema"
import { EventStore } from "@store/event"
import { ProjectionEngine } from "@projection/engine"
import { createSessionProjectionHandler } from "@projection/sessions"
import { DailyProjectionHandler } from "@projection/daily"
import { toolCallHandler } from "@projection/tool-calls"
import { SSEBroadcaster } from "@sse/broadcaster"
import { createStatsHandler } from "@api/stats"
import { createStreamHandler } from "@api/stream"
import type { StatsEvent } from "@defs/events"
import { convertEvent, convertToolEvent } from "@events/convert"

// ============================================================================
// Internal State
// ============================================================================

interface StatsState {
  db: Database
  eventStore: EventStore
  projectionEngine: ProjectionEngine
  broadcaster: SSEBroadcaster
  server: ReturnType<typeof Bun.serve> | null
}

let state: StatsState | null = null

// ============================================================================
// Helpers
// ============================================================================

function log(input: PluginInput, msg: string): void {
  void input.client?.app?.log?.({
    body: { service: "stats-plugin", level: "info", message: msg },
  })
}

/**
 * Process an event through the full pipeline:
 * 1. Insert into EventStore (idempotent)
 * 2. Process through ProjectionEngine
 * 3. Broadcast SSE update
 */
function processEvent(
  event: StatsEvent,
  eventStore: EventStore,
  projectionEngine: ProjectionEngine,
  broadcaster: SSEBroadcaster,
): void {
  eventStore.insertEvent(event)
  projectionEngine.processEvent(event)

  const statsUpdate = buildStatsUpdate(event)
  broadcaster.broadcast(statsUpdate as unknown as Record<string, unknown>)
}

/**
 * Build a lightweight stats update for SSE broadcast.
 * Mirrors buildStatsUpdate from api/stream.ts to avoid circular dependency.
 */
function buildStatsUpdate(event: StatsEvent): Record<string, unknown> {
  const base: Record<string, unknown> = {
    event_id: event.event_id,
    timestamp: new Date().toISOString(),
  }
  const sessionId = "session_id" in event ? event.session_id : ""

  switch (event.event_type) {
    case "session.created":
      return { ...base, type: "session", action: "created", session_id: sessionId }
    case "session.deleted":
      return { ...base, type: "session", action: "deleted", session_id: sessionId }
    case "tool.completed":
      return { ...base, type: "tool", action: "updated", session_id: sessionId, delta: { tool_calls: 1 } }
    case "file.edited":
      return { ...base, type: "file", action: "updated", session_id: sessionId }
    default:
      return { ...base, type: "session", action: "updated", session_id: sessionId }
  }
}

// ============================================================================
// Initialization
// ============================================================================

function initialize(input: PluginInput): StatsState {
  const defaultDir = join(homedir(), ".local", "share", "opencode-stats-dashboard")
  const dbDir = process.env["STATS_DB_DIR"] ?? defaultDir
  const dbPath = process.env["STATS_DB_PATH"] ?? join(dbDir, "stats.db")
  const port = Number(process.env["STATS_PORT"] ?? 11133)

  mkdirSync(dbDir, { recursive: true })

  log(input, `Initializing — db=${dbPath}, port=${port}`)

  // 1. Open SQLite database
  const db = new Database(dbPath)

  // 2. Configure pragmas and run migrations
  configurePragmas(db)
  const applied = runMigrations(db)
  log(input, `Database ready — applied ${applied} migration(s)`)

  // 3. Create stores and engines
  const eventStore = new EventStore(db)
  const projectionEngine = new ProjectionEngine(db)
  const broadcaster = new SSEBroadcaster()

  // 4. Register projection handlers
  projectionEngine.registerHandler("sessions", createSessionProjectionHandler())
  projectionEngine.registerHandler("daily", new DailyProjectionHandler())
  projectionEngine.registerHandler("tool-calls", toolCallHandler)
  log(input, `Registered ${projectionEngine.getHandlerNames().length} projection handlers`)

  // 5. Create Hono app and register routes
  const app = new Hono()

  // Serve dashboard static files
  // import.meta.dir points to src/ when running src/index.ts
  const projectRoot = resolve(import.meta.dir, "..")
  const dashboardDist = join(projectRoot, "dashboard", "dist")
  log(input, `Dashboard dist path: ${dashboardDist} (exists: ${existsSync(dashboardDist)})`)

  const mimeTypes: Record<string, string> = {
    ".js": "application/javascript",
    ".css": "text/css",
    ".html": "text/html",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
  }

  app.get("/assets/*", (c) => {
    const reqPath = c.req.path
    const filePath = join(dashboardDist, reqPath)
    if (existsSync(filePath)) {
      const ext = extname(filePath)
      const contentType = mimeTypes[ext] ?? "application/octet-stream"
      const content = readFileSync(filePath)
      return new Response(content, {
        headers: { "Content-Type": contentType },
      })
    }
    return c.notFound()
  })

  // Stats REST endpoints
  const statsRegistrar = createStatsHandler(db)
  statsRegistrar(app)

  // SSE stream endpoint
  const streamHandler = createStreamHandler(broadcaster)
  app.get("/api/v1/events/stream", (c) => streamHandler(c.req.raw))

  // SPA fallback — serve index.html for non-API routes
  const indexPath = join(dashboardDist, "index.html")
  log(input, `SPA fallback — indexPath: ${indexPath} (exists: ${existsSync(indexPath)})`)
  app.get("*", (c) => {
    if (existsSync(indexPath)) {
      const html = readFileSync(indexPath, "utf-8")
      return c.html(html)
    }
    return c.text(`Dashboard not built. Run: bun run build:dashboard\n\nDebug: indexPath=${indexPath}, exists=${existsSync(indexPath)}`, 404)
  })

  // 6. Start HTTP server
  const server = Bun.serve({
    port,
    idleTimeout: 0,
    fetch: app.fetch,
  })

  log(input, `HTTP server listening on port ${server.port}`)

  return { db, eventStore, projectionEngine, broadcaster, server }
}

// ============================================================================
// Plugin Definition
// ============================================================================

const StatsPlugin: Plugin = async (input) => {
  // Lazily initialize on first call
  if (!state) {
    state = initialize(input)
  }

  const { eventStore, projectionEngine, broadcaster } = state

  const hooks: Hooks = {
    // Generic event handler — covers session, message, file events
    event: async ({ event }) => {
      const statsEvent = convertEvent(event, input.directory)
      if (statsEvent) {
        processEvent(statsEvent, eventStore, projectionEngine, broadcaster)
      }
    },

    // Tool-specific hook — receives structured tool execution data
    "tool.execute.after": async (toolInput, toolOutput) => {
      const statsEvent = convertToolEvent(
        toolInput as { tool: string; sessionID: string; callID: string },
        toolOutput as { title: string; metadata: Record<string, unknown> },
        input.directory,
      )
      processEvent(statsEvent, eventStore, projectionEngine, broadcaster)
    },
  }

  return hooks
}

export default StatsPlugin
export { StatsPlugin }
export type { Plugin, PluginInput, Hooks }
