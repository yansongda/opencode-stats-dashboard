/**
 * OpenCode 统计插件 — 入口文件
 *
 * 从 opencode 收集事件，持久化到 SQLite，通过注册的处理器投影统计信息，
 * 并通过 HTTP + SSE 提供服务。
 *
 * 环境变量配置：
 *  - STATS_PORT（默认：11133）
 *  - STATS_DB_DIR（默认：~/.local/share/opencode-stats-engine/）
 *  - STATS_DB_PATH（默认：STATS_DB_DIR/stats.db）
 */

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  buildStatsNotification,
  createDashboardHandler,
  createDashboardStreamHandler,
} from "@api/dashboard";
import { configurePragmas, runMigrations } from "@db/schema";
import { convertEvent } from "@event/converter";
import type { Hooks, Plugin, PluginInput } from "@opencode-ai/plugin";
import type { Event } from "@opencode-ai/sdk";
import { ProjectionEngine } from "@projection/engine";
import { messagesHandler } from "@projection/messages";
import { sessionHandler } from "@projection/sessions";
import { toolCallHandler } from "@projection/tool-calls";
import { SSEBroadcaster } from "@sse/broadcaster";
import { EventStore } from "@store/event";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { createLogger, type Logger } from "@/logger";
import { LeaderManager } from "./server/leader";

/** 插件启动配置，由 resolveConfig() 计算 */
interface PluginConfig {
  dbDir: string;
  dbPath: string;
  port: number;
}

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
  logger: Logger;
}): Hono {
  const app = new Hono();

  app.onError((err, c) => {
    const method = c.req.method;
    const path = c.req.path;
    logger("error", `Uncaught route error: ${method} ${path}`, err);
    return c.json({ error: "Internal Server Error" }, 500);
  });

  app.use("/assets/*", serveStatic({ root: dashboardDist }));

  createDashboardHandler(db)(app);
  createDashboardStreamHandler(broadcaster)(app);

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
  private readonly config!: PluginConfig;
  private db!: Database;
  private eventStore!: EventStore;
  private projectionEngine!: ProjectionEngine;
  private broadcaster!: SSEBroadcaster;
  private leader!: LeaderManager;
  private logFile!: string;
  private log!: Logger;

  constructor() {
    this.config = this.resolveConfig();
    this.initLog();
    this.initDb();
    this.initProjection();
    this.initHttp();
  }

  // ── Config ───────────────────────────────────────────────────────────

  private resolveConfig(): PluginConfig {
    const defaultDir = join(
      homedir(),
      ".local",
      "share",
      "opencode-stats-engine",
    );
    const dbDir = process.env.STATS_DB_DIR ?? defaultDir;
    const dbPath = process.env.STATS_DB_PATH ?? join(dbDir, "stats.db");
    const port = Number(process.env.STATS_PORT ?? 11133);
    return { dbDir, dbPath, port };
  }

  // ── Initialization phases ────────────────────────────────────────────

  private initLog(): void {
    this.logFile = join(this.config.dbDir, "stats.log");
    mkdirSync(this.config.dbDir, { recursive: true });
    this.log = createLogger(this.logFile);
    this.log("info", "[stats-engine] initLog initialized");
  }

  private initDb(): void {
    this.log("info", `Initializing — db=${this.config.dbPath}`);
    this.db = new Database(this.config.dbPath);
    configurePragmas(this.db);
    const applied = runMigrations(this.db);
    this.log("info", `Database ready — applied ${applied} migration(s)`);
    this.eventStore = new EventStore(this.db);
    this.log("info", "[stats-engine] initDb initialized");
  }

  private initProjection(): void {
    this.projectionEngine = new ProjectionEngine(this.db);
    this.broadcaster = new SSEBroadcaster({
      onError: (error, clientId) => {
        this.log("error", `SSE client ${clientId}: ${error.message}`, error);
      },
    });
    this.projectionEngine.registerHandler(sessionHandler);
    this.projectionEngine.registerHandler(messagesHandler);
    this.projectionEngine.registerHandler(toolCallHandler);
    this.log(
      "info",
      `Registered ${this.projectionEngine.size} projection handlers`,
    );
    this.log("info", "[stats-engine] initProjection initialized");
  }

  private initHttp(): void {
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
      logger: this.log,
    });
    this.leader = new LeaderManager({
      port: this.config.port,
      fetch: app.fetch,
      log: this.log,
    });
    this.leader.start();
    const role = this.leader.getRole();
    this.log("info", `[stats-engine] initHttp initialized role=${role}`);
  }

  /** 用 try/catch 包装同步代码块，带结构化错误日志 */
  private safely(desc: string, fn: () => void): void {
    try {
      fn();
    } catch (err) {
      this.log("error", desc, err);
    }
  }

  // ── Event processing ─────────────────────────────────────────────────

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

  // ── Disposal ─────────────────────────────────────────────────────────

  /** 释放所有拥有的资源。leader 和 follower 均安全调用，可多次调用。 */
  dispose(): void {
    const role = this.leader.getRole();
    this.log("info", `[stats-engine] shutdown role=${role}`);
    try {
      this.broadcaster.dispose();
    } catch (err) {
      this.log("error", "broadcaster.dispose failed", err);
    }
    this.leader.stop();
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
