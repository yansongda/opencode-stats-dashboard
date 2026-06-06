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

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createStatsHandler } from "@api/stats";
import { createStreamHandler } from "@api/stream";
import { configurePragmas, runMigrations } from "@db/schema";
import type { StatsEvent, ToolEventInput, ToolEventOutput } from "@defs/events";
import type { SSEAction, SSEEventType, StatsUpdate } from "@defs/sse";
import { convertEvent, convertToolEvent } from "@event/converter";
import type { Hooks, Plugin, PluginInput } from "@opencode-ai/plugin";
import { DailyProjectionHandler } from "@projection/daily";
import { ProjectionEngine } from "@projection/engine";
import { createSessionProjectionHandler } from "@projection/sessions";
import { toolCallHandler } from "@projection/tool-calls";
import { SSEBroadcaster } from "@sse/broadcaster";
import { EventStore } from "@store/event";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";

// ============================================================================
// Internal State
// ============================================================================

interface StatsState {
  db: Database;
  eventStore: EventStore;
  projectionEngine: ProjectionEngine;
  broadcaster: SSEBroadcaster;
  server: ReturnType<typeof Bun.serve> | null;
}

let state: StatsState | null = null;

// ============================================================================
// Helpers
// ============================================================================

function log(input: PluginInput, msg: string): void {
  void input.client?.app?.log?.({
    body: { service: "stats-plugin", level: "info", message: msg },
  });
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
  eventStore.insertEvent(event);
  projectionEngine.processEvent(event);

  const statsUpdate = buildStatsUpdate(event);
  broadcaster.broadcast(statsUpdate);
}

/**
 * Build a lightweight stats update for SSE broadcast.
 * Mirrors buildStatsUpdate from api/stream.ts to avoid circular dependency.
 */
const EVENT_TYPE_MAP: Record<
  string,
  { type: SSEEventType; action: SSEAction }
> = {
  "session.created": { type: "session", action: "created" },
  "session.deleted": { type: "session", action: "deleted" },
  "tool.completed": { type: "tool", action: "updated" },
  "file.edited": { type: "file", action: "updated" },
};

function buildStatsUpdate(event: StatsEvent): StatsUpdate {
  const sessionId = "session_id" in event ? event.session_id : "";
  const mapped = EVENT_TYPE_MAP[event.event_type] ?? {
    type: "session" as SSEEventType,
    action: "updated" as SSEAction,
  };

  return {
    event_id: event.event_id,
    timestamp: new Date().toISOString(),
    session_id: sessionId,
    ...mapped,
    ...(event.event_type === "tool.completed" && { delta: { tool_calls: 1 } }),
  };
}

// ============================================================================
// Initialization
// ============================================================================

function initialize(input: PluginInput): StatsState {
  const defaultDir = join(
    homedir(),
    ".local",
    "share",
    "opencode-stats-dashboard",
  );
  const dbDir = process.env.STATS_DB_DIR ?? defaultDir;
  const dbPath = process.env.STATS_DB_PATH ?? join(dbDir, "stats.db");
  const port = Number(process.env.STATS_PORT ?? 11133);

  mkdirSync(dbDir, { recursive: true });

  log(input, `Initializing — db=${dbPath}, port=${port}`);

  // 1. Open SQLite database
  const db = new Database(dbPath);

  // 2. Configure pragmas and run migrations
  configurePragmas(db);
  const applied = runMigrations(db);
  log(input, `Database ready — applied ${applied} migration(s)`);

  // 3. Create stores and engines
  const eventStore = new EventStore(db);
  const projectionEngine = new ProjectionEngine(db);
  const broadcaster = new SSEBroadcaster();

  // 4. Register projection handlers
  projectionEngine.registerHandler(
    "sessions",
    createSessionProjectionHandler(),
  );
  projectionEngine.registerHandler("daily", new DailyProjectionHandler());
  projectionEngine.registerHandler("tool-calls", toolCallHandler);
  log(
    input,
    `Registered ${projectionEngine.getHandlerNames().length} projection handlers`,
  );

  // 5. Create Hono app and register routes
  const app = new Hono();

  // Serve dashboard static files
  // import.meta.dir points to src/ when running src/index.ts
  const projectRoot = resolve(import.meta.dir, "..");
  const dashboardDist = join(projectRoot, "dashboard", "dist");
  log(
    input,
    `Dashboard dist path: ${dashboardDist} (exists: ${existsSync(dashboardDist)})`,
  );

  app.use("/assets/*", serveStatic({ root: dashboardDist }));

  // Stats REST endpoints
  const statsRegistrar = createStatsHandler(db);
  statsRegistrar(app);

  // SSE stream endpoint
  const streamHandler = createStreamHandler(broadcaster);
  app.get("/api/v1/events/stream", (c) => streamHandler(c.req.raw));

  // SPA fallback — serve index.html for non-API routes
  const indexPath = join(dashboardDist, "index.html");
  log(
    input,
    `SPA fallback — indexPath: ${indexPath} (exists: ${existsSync(indexPath)})`,
  );
  const indexHtml = existsSync(indexPath)
    ? readFileSync(indexPath, "utf-8")
    : null;
  app.get("*", (c) => {
    if (indexHtml) return c.html(indexHtml);
    return c.text(
      `Dashboard not built. Run: bun run build:dashboard\n\nDebug: indexPath=${indexPath}, exists=false`,
      404,
    );
  });

  // 6. Start HTTP server
  const server = Bun.serve({
    port,
    idleTimeout: 0,
    fetch: app.fetch,
  });

  log(input, `HTTP server listening on port ${server.port}`);

  return { db, eventStore, projectionEngine, broadcaster, server };
}

// ============================================================================
// Plugin Definition
// ============================================================================

const StatsPlugin: Plugin = async (input) => {
  // Lazily initialize on first call
  if (!state) {
    state = initialize(input);
  }

  const { eventStore, projectionEngine, broadcaster } = state;

  const hooks: Hooks = {
    // Generic event handler — covers session, message, file events
    event: async ({ event }) => {
      const statsEvent = convertEvent(event, input.directory);
      if (statsEvent) {
        processEvent(statsEvent, eventStore, projectionEngine, broadcaster);
      }
    },

    // Tool-specific hook — receives structured tool execution data
    "tool.execute.after": async (
      toolInput: ToolEventInput,
      toolOutput: ToolEventOutput,
    ) => {
      const statsEvent = convertToolEvent(
        toolInput,
        toolOutput,
        input.directory,
      );
      processEvent(statsEvent, eventStore, projectionEngine, broadcaster);
    },
  };

  return hooks;
};

export default StatsPlugin;
export type { Hooks, Plugin, PluginInput };
