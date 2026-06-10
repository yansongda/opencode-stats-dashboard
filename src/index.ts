/**
 * OpenCode 统计插件 — 入口文件
 *
 * 从 opencode 收集事件，持久化到 SQLite，通过注册的处理器投影统计信息，
 * 并通过 HTTP + SSE 提供服务。
 *
 * 环境变量配置：
 *  - STATS_PORT（默认：11133）
 *  - STATS_DB_DIR（默认：~/.local/share/opencode-stats-dashboard/）
 *  - STATS_DB_PATH（默认：STATS_DB_DIR/stats.db）
 */

import { Database } from "bun:sqlite";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createDashboardHandler } from "@api/dashboard";
import { buildStatsNotification, createStreamHandler } from "@api/stream";
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

/** 构建 Hono 应用。纯函数：接收依赖，返回应用 */
function createApp({
  db,
  broadcaster,
  dashboardDist,
  logger,
}: {
  db: Database;
  broadcaster: SSEBroadcaster;
  dashboardDist: string;
  logger: (level: "info" | "error", msg: string, err?: unknown) => void;
}): Hono {
  const app = new Hono();

  app.onError((err, c) => {
    const method = c.req.method;
    const path = c.req.path;
    logger("error", `Uncaught route error: ${method} ${path}`, err);
    return c.json({ error: "Internal Server Error" }, 500);
  });

  app.use("/assets/*", serveStatic({ root: dashboardDist }));

  const dashboardRegistrar = createDashboardHandler(db);
  dashboardRegistrar(app);

  const streamHandler = createStreamHandler(broadcaster);
  app.get("/api/v1/dashboard/stream", (c) => streamHandler(c.req.raw));

  // 未处理的 API 路由返回 JSON 404，避免落入 SPA 回退
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
 * 插件状态管理类
 *
 * 拥有所有插件状态：数据库、投影引擎、SSE 广播器、HTTP 服务器和日志器。
 * 首次调用时懒加载构造，后续调用复用同一实例。
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
    this.broadcaster = new SSEBroadcaster({
      onError: (error, clientId) => {
        this.log("error", `SSE client ${clientId}: ${error.message}`, error);
      },
    });

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

    // import.meta.dir 在运行 src/index.ts 时指向 src/
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
      logger: this.log.bind(this),
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
  }

  /** 用 try/catch 包装同步代码块，带结构化错误日志 */
  private safely(desc: string, fn: () => void): void {
    try {
      fn();
    } catch (err) {
      this.log("error", desc, err);
    }
  }

  /**
   * 统一的事件处理入口：转换 → 持久化 → 投影 → 广播
   *
   * 事件溯源一致性优先：持久化失败阻断投影和广播，投影失败阻断广播。
   * 转换错误和管道错误被拦截并写入日志，不向宿主传播。
   * 广播阶段各客户端错误通过 safely() 隔离，互不影响。
   */
  processEvent(sdkEvent: Event, directory: string): void {
    this.safely(`convertEvent failed for ${sdkEvent.type}`, () => {
      const statsEvents = convertEvent(sdkEvent, directory);
      if (statsEvents.length === 0) return;

      const tag = statsEvents[0]?.event_type ?? "unknown";

      // 1. 批量持久化（失败则阻断后续阶段）
      try {
        this.eventStore.insertEvents(statsEvents);
      } catch (err) {
        this.log("error", `eventStore.insertEvents failed for ${tag}`, err);
        return;
      }

      // 2. 批量投影（失败则阻断广播）
      try {
        this.projectionEngine.processEvents(statsEvents);
      } catch (err) {
        this.log(
          "error",
          `projectionEngine.processEvents failed for ${tag}`,
          err,
        );
        return;
      }

      // 3. 逐个广播（各客户端错误隔离）
      for (const event of statsEvents) {
        this.safely(`broadcaster.broadcast failed for ${tag}`, () =>
          this.broadcaster.broadcast(buildStatsNotification(event)),
        );
      }
    });
  }

  /** 释放所有拥有的资源。可安全多次调用。 */
  dispose(): void {
    if (!this.server) return;
    try {
      this.broadcaster.dispose();
    } catch (err) {
      this.log("error", "broadcaster.dispose failed", err);
    }
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
