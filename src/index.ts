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
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createStatsHandler } from "@api/stats";
import { buildStatsUpdate, createStreamHandler } from "@api/stream";
import { configurePragmas, runMigrations } from "@db/schema";
import { convertEvent } from "@event/converter";
import type { Hooks, Plugin, PluginInput } from "@opencode-ai/plugin";
import type { Event } from "@opencode-ai/sdk";
import { ProjectionEngine } from "@projection/engine";
import { messagesHandler } from "@projection/messages";
import { createSessionProjectionHandler } from "@projection/sessions";
import { toolCallHandler } from "@projection/tool-calls";
import { SSEBroadcaster } from "@sse/broadcaster";
import { EventStore } from "@store/event";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";

/** Build the Hono application. Pure: takes deps, returns app. */
function createApp({
  db,
  broadcaster,
  dashboardDist,
}: {
  db: Database;
  broadcaster: SSEBroadcaster;
  dashboardDist: string;
}): Hono {
  const app = new Hono();

  app.use("/assets/*", serveStatic({ root: dashboardDist }));

  const statsRegistrar = createStatsHandler(db);
  statsRegistrar(app);

  const streamHandler = createStreamHandler(broadcaster);
  app.get("/api/v1/events/stream", (c) => streamHandler(c.req.raw));

  // Explicit JSON 404 for unhandled API routes — keep them out of SPA fallback.
  app.all("/api/*", (c) => c.json({ error: "not_found" }, 404));

  const indexPath = join(dashboardDist, "index.html");

  app.get("*", (c) => {
    if (existsSync(indexPath)) {
      const html = readFileSync(indexPath, "utf-8");
      return c.html(html);
    }
    return c.text(
      `Dashboard not built. Run: bun run build:dashboard\n\nDebug: indexPath=${indexPath}, exists=false`,
      404,
    );
  });

  return app;
}

/**
 * Owns all plugin state — DB, projection engine, SSE broadcaster, HTTP server,
 * and the logger. Constructed lazily on first plugin invocation; subsequent
 * invocations of the exported `StatsPlugin` factory reuse the same instance.
 */
class StatsPluginInstance {
  private readonly db: Database;
  private readonly eventStore: EventStore;
  private readonly projectionEngine: ProjectionEngine;
  private readonly broadcaster: SSEBroadcaster;
  private server: ReturnType<typeof Bun.serve> | null;
  private readonly logFile: string;

  constructor() {
    const defaultDir = join(
      homedir(),
      ".local",
      "share",
      "opencode-stats-engine",
    );
    const dbDir = process.env.STATS_DB_DIR ?? defaultDir;
    const dbPath = process.env.STATS_DB_PATH ?? join(dbDir, "stats.db");
    const port = Number(process.env.STATS_PORT ?? 11133);

    this.logFile = join(dbDir, "stats.log");
    mkdirSync(dbDir, { recursive: true });

    this.log("info", `Initializing — db=${dbPath}, port=${port}`);

    this.db = new Database(dbPath);
    configurePragmas(this.db);
    const applied = runMigrations(this.db);
    this.log("info", `Database ready — applied ${applied} migration(s)`);

    this.eventStore = new EventStore(this.db);
    this.projectionEngine = new ProjectionEngine(this.db);
    this.broadcaster = new SSEBroadcaster();

    this.projectionEngine.registerHandler(
      "sessions",
      createSessionProjectionHandler(),
    );
    this.projectionEngine.registerHandler("messages", messagesHandler);
    this.projectionEngine.registerHandler("tool-calls", toolCallHandler);
    this.log(
      "info",
      `Registered ${this.projectionEngine.getHandlerNames().length} projection handlers`,
    );

    // import.meta.dir points to src/ when running src/index.ts
    const projectRoot = resolve(import.meta.dir, "..");
    const dashboardDist = join(projectRoot, "dashboard", "dist");
    this.log(
      "info",
      `Dashboard dist path: ${dashboardDist} (exists: ${existsSync(dashboardDist)})`,
    );

    const app = createApp({
      db: this.db,
      broadcaster: this.broadcaster,
      dashboardDist,
    });

    this.server = Bun.serve({ port, idleTimeout: 0, fetch: app.fetch });
    this.log("info", `HTTP server listening on port ${this.server.port}`);
  }

  log(level: "info" | "error", msg: string, err?: unknown): void {
    const detail =
      err === undefined
        ? msg
        : err instanceof Error
          ? `${msg} — ${err.name}: ${err.message}`
          : `${msg} — ${String(err)}`;

    try {
      appendFileSync(
        this.logFile,
        `[${new Date().toISOString()}] [${level}] ${detail}\n`,
      );
    } catch {}

    if (level === "error") {
      console.error(`[stats-plugin] ${msg}`, err);
    }
  }

  /** Wrap a sync block with try/catch + structured error logging. */
  private safely(desc: string, fn: () => void): void {
    try {
      fn();
    } catch (err) {
      this.log("error", desc, err);
    }
  }

  /**
   * Unified event processing entry point — convert, persist, project, broadcast.
   *
   * A failure in one stage MUST NOT prevent the others from running. In
   * particular, a slow/dead SSE client should never block persistence, and a
   * projection bug should never silence the live broadcast.
   */
  processEvent(sdkEvent: Event, directory: string): void {
    this.safely(`convertEvent failed for ${sdkEvent.type}`, () => {
      const statsEvents = convertEvent(sdkEvent, directory);
      if (statsEvents.length === 0) return;

      const tag = statsEvents[0]?.event_type ?? "unknown";

      // 1. 批量持久化
      this.safely(`eventStore.insertEvents failed for ${tag}`, () =>
        this.eventStore.insertEvents(statsEvents),
      );

      // 2. 批量投影
      this.safely(`projectionEngine.processEvents failed for ${tag}`, () =>
        this.projectionEngine.processEvents(statsEvents),
      );

      // 3. 逐个广播
      for (const event of statsEvents) {
        this.safely(`broadcaster.broadcast failed for ${tag}`, () =>
          this.broadcaster.broadcast(buildStatsUpdate(event)),
        );
      }
    });
  }

  /** Release all owned resources. Safe to call multiple times. */
  dispose(): void {
    if (!this.server) return;
    try {
      this.server.stop();
    } catch (err) {
      this.log("error", "server.stop failed", err);
    }
    this.server = null;
    try {
      this.db.close();
    } catch (err) {
      this.log("error", "db.close failed", err);
    }
    this.log("info", "Disposed");
  }
}

let instance: StatsPluginInstance | null = null;

const StatsPlugin: Plugin = async (input) => {
  if (!instance) {
    instance = new StatsPluginInstance();
  }
  const self = instance;

  const hooks: Hooks = {
    dispose: async () => {
      self.dispose();
      instance = null;
    },
    event: async ({ event }) => self.processEvent(event, input.directory),
  };

  return hooks;
};

export default StatsPlugin;
export type { Hooks, Plugin, PluginInput };
