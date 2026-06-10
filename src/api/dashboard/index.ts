/**
 * Dashboard route registrar — registers all seven dashboard page endpoints.
 *
 * Registers the page-level dashboard query routes.
 *
 * Endpoints:
 *  - GET /api/v1/dashboard/overview        — overview page
 *  - GET /api/v1/dashboard/efficiency      — efficiency analysis page
 *  - GET /api/v1/dashboard/models          — model comparison page
 *  - GET /api/v1/dashboard/projects        — project comparison page
 *  - GET /api/v1/dashboard/tools           — tool statistics page
 *  - GET /api/v1/dashboard/sessions        — session list page
 *  - GET /api/v1/dashboard/sessions/:id    — session detail page
 */

import type { Database } from "bun:sqlite";
import type { RouteRegistrar } from "@defs/api";
import type { StatsEvent } from "@defs/events";
import type { StatsNotification } from "@defs/stream";
import type { SSEBroadcaster } from "@sse/broadcaster";
import type { Hono } from "hono";

import { createEfficiencyHandler } from "./efficiency";
import { createModelsDashboardHandler } from "./models";
import { createOverviewDashboardHandler } from "./overview";
import { createProjectsDashboardHandler } from "./projects";
import { createDashboardSessionsHandler } from "./sessions";
import { createDashboardSessionDetailHandler } from "./sessions-detail";
import { createDashboardToolsHandler } from "./tools";

/**
 * Create a dashboard route registrar for the given database.
 *
 * Usage:
 *   const app = new Hono()
 *   createDashboardHandler(db)(app)
 */
export function createDashboardHandler(db: Database): RouteRegistrar {
  return (app: Hono) => {
    app.get("/api/v1/dashboard/overview", createOverviewDashboardHandler(db));
    app.get("/api/v1/dashboard/efficiency", createEfficiencyHandler(db));
    app.get("/api/v1/dashboard/models", createModelsDashboardHandler(db));
    app.get("/api/v1/dashboard/projects", createProjectsDashboardHandler(db));
    app.get("/api/v1/dashboard/tools", createDashboardToolsHandler(db));
    app.get("/api/v1/dashboard/sessions", createDashboardSessionsHandler(db));
    app.get(
      "/api/v1/dashboard/sessions/:id",
      createDashboardSessionDetailHandler(db),
    );
  };
}

// ============================================================================
// buildStatsNotification — Event → Notification Mapping (§6.6)
// ============================================================================

/**
 * Build a lightweight StatsNotification from a StatsEvent.
 *
 * Every event maps to the same minimal notification shape:
 *  - version: 1
 *  - event_id
 *  - event_type (authoritative, from the event itself)
 *  - occurred_at_ms = event.created_at_ms
 *  - occurred_at = new Date(event.created_at_ms).toISOString()
 *  - session_id (optional, present when the event has one)
 *
 * No business-delta semantics — no type/action categorization, no
 * tokens/cost/tool_calls/errors aggregates.
 */
export function buildStatsNotification(event: StatsEvent): StatsNotification {
  return {
    version: 1,
    event_id: event.event_id,
    event_type: event.event_type,
    occurred_at_ms: event.created_at_ms,
    occurred_at: new Date(event.created_at_ms).toISOString(),
    session_id: event.session_id,
  };
}

// ============================================================================
// SSE Response Headers (§6.5)
// ============================================================================

const SSE_HEADERS: Record<string, string> = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
};

// ============================================================================
// createDashboardStreamHandler — SSE Route Registrar Factory
// ============================================================================

/**
 * Create a route registrar for the SSE stream endpoint.
 *
 * The registrar mounts: GET /api/v1/dashboard/stream
 *
 * @param broadcaster - SSEBroadcaster instance for managing connections
 * @returns A RouteRegistrar that mounts the SSE route onto a Hono app
 */
export function createDashboardStreamHandler(
  broadcaster: SSEBroadcaster,
): RouteRegistrar {
  return (app) => {
    app.get("/api/v1/dashboard/stream", (_c) => {
      return new Response(broadcaster.addClient(), {
        status: 200,
        headers: SSE_HEADERS,
      });
    });
  };
}
