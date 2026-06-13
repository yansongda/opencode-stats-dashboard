/**
 * @opencode-stats/engine — Backend core for the OpenCode stats engine.
 *
 * Re-exports the public surface needed by the plugin entry and tests.
 */

// ── API ──────────────────────────────────────────────────────────────────────
export {
  buildStatsNotification,
  createDashboardHandler,
  createDashboardStreamHandler,
} from "./api/dashboard";

// ── Database ─────────────────────────────────────────────────────────────────
export { CURRENT_VERSION, configurePragmas, runMigrations } from "./db/schema";

// ── Event conversion ─────────────────────────────────────────────────────────
export { convertEvent, registerConverter } from "./event/converter";

// ── Projection ───────────────────────────────────────────────────────────────
export { ProjectionEngine } from "./projection/engine";
export { messagesHandler } from "./projection/messages";
export { sessionHandler } from "./projection/sessions";
export { toolCallHandler } from "./projection/tool-calls";
export type { Logger, ServerRole } from "./server/leader";
// ── Server ───────────────────────────────────────────────────────────────────
export { LeaderManager } from "./server/leader";
export type { SSEBroadcasterOptions } from "./sse/broadcaster";
// ── SSE ──────────────────────────────────────────────────────────────────────
export { SSEBroadcaster } from "./sse/broadcaster";
export type { EventQueryFilters, EventRow } from "./store/event";
// ── Store ────────────────────────────────────────────────────────────────────
export { EventStore } from "./store/event";
