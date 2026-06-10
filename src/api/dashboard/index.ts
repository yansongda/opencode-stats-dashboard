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
