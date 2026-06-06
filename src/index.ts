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
import { buildStatsUpdate, createStreamHandler } from "@api/stream";
import { configurePragmas, runMigrations } from "@db/schema";
import type { StatsEvent, ToolEventInput, ToolEventOutput } from "@defs/events";
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
let initPromise: Promise<StatsState> | null = null;

// ============================================================================
// Helpers
// ============================================================================

function log(input: PluginInput, msg: string): void {
  try {
    const result = input.client?.app?.log?.({
      body: { service: "stats-plugin", level: "info", message: msg },
    });
    // Surface async errors instead of swallowing them silently.
    if (result && typeof (result as Promise<unknown>).catch === "function") {
      (result as Promise<unknown>).catch((err) => {
        console.error("[stats-plugin] log failed:", err);
      });
    }
  } catch (err) {
    console.error("[stats-plugin] log threw:", err);
  }
}

function logError(input: PluginInput, msg: string, err: unknown): void {
  const detail =
    err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  log(input, `${msg} — ${detail}`);
  // Always echo to console so failures are visible even if remote log is down.
  console.error(`[stats-plugin] ${msg}`, err);
}

/**
 * Process an event through the full pipeline with per-stage error isolation:
 *  1. Insert into EventStore (idempotent)
 *  2. Process through ProjectionEngine
 *  3. Broadcast SSE update
 *
 * A failure in one stage MUST NOT prevent the others from running. In
 * particular, a slow/dead SSE client should never block persistence, and a
 * projection bug should never silence the live broadcast.
 */
function processEvent(event: StatsEvent, input: PluginInput): void {
  if (!state) return;
  const { eventStore, projectionEngine, broadcaster } = state;

  try {
    eventStore.insertEvent(event);
  } catch (err) {
    logError(
      input,
      `eventStore.insertEvent failed for ${event.event_type}`,
      err,
    );
  }

  try {
    projectionEngine.processEvent(event);
  } catch (err) {
    logError(
      input,
      `projectionEngine.processEvent failed for ${event.event_type}`,
      err,
    );
  }

  try {
    const statsUpdate = buildStatsUpdate(event);
    broadcaster.broadcast(statsUpdate);
  } catch (err) {
    logError(
      input,
      `broadcaster.broadcast failed for ${event.event_type}`,
      err,
    );
  }
}

// ============================================================================
// App construction
// ============================================================================

interface AppDeps {
  db: Database;
  broadcaster: SSEBroadcaster;
  dashboardDist: string;
}

/**
 * Build the Hono application. Pure: takes deps, returns app.
 *
 * Route ordering matters:
 *  1. /assets/*           — dashboard bundles
 *  2. /api/*              — JSON endpoints (stats + SSE stream)
 *  3. catch-all GET *     — SPA fallback (only for non-/api routes)
 *
 * Unknown /api/* requests get a JSON 404 instead of an HTML SPA shell, so
 * frontend fetch errors are debuggable.
 */
function createApp({ db, broadcaster, dashboardDist }: AppDeps): Hono {
  const app = new Hono();

  app.use("/assets/*", serveStatic({ root: dashboardDist }));

  const statsRegistrar = createStatsHandler(db);
  statsRegistrar(app);

  const streamHandler = createStreamHandler(broadcaster);
  app.get("/api/v1/events/stream", (c) => streamHandler(c.req.raw));

  // Explicit JSON 404 for unhandled API routes — keep them out of SPA fallback.
  app.all("/api/*", (c) => c.json({ error: "not_found" }, 404));

  const indexPath = join(dashboardDist, "index.html");
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

  return app;
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

  // 5. Build the HTTP app
  // import.meta.dir points to src/ when running src/index.ts
  const projectRoot = resolve(import.meta.dir, "..");
  const dashboardDist = join(projectRoot, "dashboard", "dist");
  log(
    input,
    `Dashboard dist path: ${dashboardDist} (exists: ${existsSync(dashboardDist)})`,
  );

  const app = createApp({ db, broadcaster, dashboardDist });

  // 6. Start HTTP server
  const server = Bun.serve({
    port,
    idleTimeout: 0,
    fetch: app.fetch,
  });

  log(input, `HTTP server listening on port ${server.port}`);

  return { db, eventStore, projectionEngine, broadcaster, server };
}

/**
 * Initialize-once with a promise lock to guard against concurrent first-touch
 * (multiple hook invocations racing before `state` is set).
 */
async function ensureInitialized(input: PluginInput): Promise<StatsState> {
  if (state) return state;
  if (!initPromise) {
    initPromise = Promise.resolve().then(() => {
      state = initialize(input);
      return state;
    });
  }
  return initPromise;
}

/**
 * Release all owned resources. Safe to call multiple times.
 */
async function dispose(input: PluginInput): Promise<void> {
  const s = state;
  if (!s) return;
  state = null;
  initPromise = null;

  try {
    s.server?.stop();
  } catch (err) {
    logError(input, "server.stop failed", err);
  }
  try {
    s.db.close();
  } catch (err) {
    logError(input, "db.close failed", err);
  }
  log(input, "Disposed");
}

// ============================================================================
// Plugin Definition
// ============================================================================

const StatsPlugin: Plugin = async (input) => {
  await ensureInitialized(input);

  const hooks: Hooks = {
    dispose: () => dispose(input),

    // Generic event handler — covers session, message, file events
    event: async ({ event }) => {
      try {
        const statsEvent = convertEvent(event, input.directory);
        if (statsEvent) {
          processEvent(statsEvent, input);
        }
      } catch (err) {
        logError(input, `convertEvent failed for ${event.type}`, err);
      }
    },

    // Tool-specific hook — receives structured tool execution data
    "tool.execute.after": async (
      toolInput: ToolEventInput,
      toolOutput: ToolEventOutput,
    ) => {
      try {
        const statsEvent = convertToolEvent(
          toolInput,
          toolOutput,
          input.directory,
        );
        processEvent(statsEvent, input);
      } catch (err) {
        logError(input, "convertToolEvent failed", err);
      }
    },
  };

  return hooks;
};

export default StatsPlugin;
export type { Hooks, Plugin, PluginInput };
