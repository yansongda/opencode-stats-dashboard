import type {
  DashboardDataResponse,
  DashboardEfficiencyData,
  DashboardModelsData,
  DashboardOverviewData,
  DashboardProjectsData,
  DashboardSessionDetailData,
  DashboardSessionListItem,
  DashboardToolsData,
} from "@opencode-stats/shared";
import { getBrowserTimezone } from "../utils/timezone";

// ── Dashboard-local types ───────────────────────────────────────────────

export interface DashboardTimeRange {
  start?: number;
  end?: number;
}

export type {
  DashboardDataResponse,
  DashboardEfficiencyData,
  DashboardEfficiencyHeatmapPoint,
  DashboardEfficiencySummary,
  DashboardEfficiencyTimelinePoint,
  DashboardModelCostTrendPoint,
  DashboardModelItem,
  DashboardModelsData,
  DashboardOverviewData,
  DashboardOverviewProjectDistributionItem,
  DashboardOverviewSummary,
  DashboardOverviewTopModel,
  DashboardOverviewTrendPoint,
  DashboardProjectActivityTrendPoint,
  DashboardProjectItem,
  DashboardProjectModelUsageItem,
  DashboardProjectsData,
  DashboardSessionDetailData,
  DashboardSessionDetailSummary,
  DashboardSessionError,
  DashboardSessionListItem,
  DashboardSessionMessageMetadata,
  DashboardSessionModelUsage,
  DashboardSessionToolCall,
  DashboardToolItem,
  DashboardToolRecentError,
  DashboardToolsData,
  DashboardToolsSummary,
  DashboardToolTimelinePoint,
} from "@opencode-stats/shared";

// ── API Client ─────────────────────────────────────────────────────────

const DEFAULT_BASE = "";

let baseUrl = DEFAULT_BASE;

export function setBaseUrl(url: string): void {
  baseUrl = url.replace(/\/+$/, "");
}

function getOrigin(): string {
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return "http://localhost";
}

function buildUrl(
  path: string,
  params?: Record<string, string | boolean | number | undefined>,
): string {
  const url = new URL(path, baseUrl || getOrigin());
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
  }
  // Return just pathname + search when base is default (same-origin)
  if (!baseUrl) {
    return url.pathname + url.search;
  }
  return url.toString();
}

async function getJson<T>(
  path: string,
  params?: Record<string, string | boolean | number | undefined>,
): Promise<T> {
  const url = buildUrl(path, params);
  const res = await fetch(url, {
    cache: "no-store",
    headers: { Accept: "application/json", "Cache-Control": "no-cache" },
  });
  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

// ── Dashboard API functions ────────────────────────────────────────────

export function fetchDashboardOverview(
  start?: number,
  end?: number,
): Promise<DashboardOverviewData> {
  return getJson<DashboardDataResponse<DashboardOverviewData>>(
    "/api/v1/dashboard/overview",
    {
      start,
      end,
      tz: getBrowserTimezone(),
    },
  ).then((r) => r.data);
}

export function fetchDashboardEfficiency(
  start?: number,
  end?: number,
): Promise<DashboardEfficiencyData> {
  return getJson<DashboardDataResponse<DashboardEfficiencyData>>(
    "/api/v1/dashboard/efficiency",
    {
      start,
      end,
      tz: getBrowserTimezone(),
    },
  ).then((r) => r.data);
}

export function fetchDashboardModels(
  start?: number,
  end?: number,
): Promise<DashboardModelsData> {
  return getJson<DashboardDataResponse<DashboardModelsData>>(
    "/api/v1/dashboard/models",
    {
      start,
      end,
      tz: getBrowserTimezone(),
    },
  ).then((r) => r.data);
}

export function fetchDashboardProjects(
  start?: number,
  end?: number,
  params?: { sort?: string; order?: "asc" | "desc" },
): Promise<DashboardProjectsData> {
  return getJson<DashboardDataResponse<DashboardProjectsData>>(
    "/api/v1/dashboard/projects",
    {
      start,
      end,
      sort: params?.sort,
      order: params?.order,
      tz: getBrowserTimezone(),
    },
  ).then((r) => r.data);
}

export function fetchDashboardTools(
  start?: number,
  end?: number,
): Promise<DashboardToolsData> {
  return getJson<DashboardDataResponse<DashboardToolsData>>(
    "/api/v1/dashboard/tools",
    {
      start,
      end,
      tz: getBrowserTimezone(),
    },
  ).then((r) => r.data);
}

export function fetchDashboardSessions(
  start?: number,
  end?: number,
  params?: { limit?: number; offset?: number; status?: string },
): Promise<DashboardSessionListItem[]> {
  return getJson<DashboardDataResponse<DashboardSessionListItem[]>>(
    "/api/v1/dashboard/sessions",
    {
      start,
      end,
      limit: params?.limit,
      offset: params?.offset,
      status: params?.status,
      tz: getBrowserTimezone(),
    },
  ).then((r) => r.data);
}

export function fetchDashboardSessionDetail(
  sessionId: string,
): Promise<DashboardSessionDetailData> {
  return getJson<DashboardDataResponse<DashboardSessionDetailData>>(
    `/api/v1/dashboard/sessions/${sessionId}`,
    { tz: getBrowserTimezone() },
  ).then((r) => r.data);
}

// ── SSE ────────────────────────────────────────────────────────────────

export function connectSSE(): EventSource {
  const url = buildUrl("/api/v1/dashboard/stream");
  return new EventSource(url);
}
