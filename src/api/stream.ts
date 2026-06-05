/**
 * SSE stream endpoint — GET /api/v1/events/stream
 *
 * Provides real-time stats update notifications via Server-Sent Events.
 * SSE is used ONLY for lightweight notifications (event_id + timestamp + type).
 * Actual data is fetched via REST API on user demand.
 *
 * Design reference: docs/superpowers/specs/2026-06-04-event-sourced-stats-engine-design.md §6.3–6.6
 */

import type { SSEBroadcaster } from "../sse/broadcaster"
import type { IngestEventEnvelope } from "../types/events"
import type { StatsUpdate, SSEEventType, SSEAction } from "../types/sse"
import type { APIRouter } from "./router"

// ============================================================================
// buildStatsUpdate — Event → SSE Notification Mapping (§6.6)
// ============================================================================

/**
 * Build a lightweight StatsUpdate notification from an ingested event.
 *
 * Mapping rules (from design doc §6.6):
 *  - session.created  → type=session, action=created
 *  - session.deleted  → type=session, action=deleted
 *  - usage.updated    → type=message, action=updated, delta={tokens, cost_usd}
 *  - tool.started     → type=tool,    action=created, delta={tool_calls: 1}
 *  - tool.completed   → type=tool,    action=updated, delta={tool_calls: 1}
 *  - tool.failed      → type=error,   action=created, delta={errors: 1}
 *  - everything else  → type=session, action=updated
 */
export function buildStatsUpdate(event: IngestEventEnvelope): StatsUpdate {
  const base = {
    event_id: event.event_id,
    timestamp: new Date().toISOString(),
  }

  switch (event.event_type) {
    case "session.created":
      return {
        ...base,
        type: "session" as SSEEventType,
        action: "created" as SSEAction,
        session_id: event.session_id,
      }

    case "session.deleted":
      return {
        ...base,
        type: "session" as SSEEventType,
        action: "deleted" as SSEAction,
        session_id: event.session_id,
      }

    case "usage.updated":
      return {
        ...base,
        type: "message" as SSEEventType,
        action: "updated" as SSEAction,
        session_id: event.session_id,
        delta: {
          tokens: event.tokens,
          cost_usd: event.cost_usd,
        },
      }

    case "tool.started":
      return {
        ...base,
        type: "tool" as SSEEventType,
        action: "created" as SSEAction,
        session_id: event.session_id,
        delta: {
          tool_calls: 1,
        },
      }

    case "tool.completed":
      return {
        ...base,
        type: "tool" as SSEEventType,
        action: "updated" as SSEAction,
        session_id: event.session_id,
        delta: {
          tool_calls: 1,
        },
      }

    case "tool.failed":
      return {
        ...base,
        type: "error" as SSEEventType,
        action: "created" as SSEAction,
        session_id: event.session_id,
        delta: {
          errors: 1,
        },
      }

    default:
      return {
        ...base,
        type: "session" as SSEEventType,
        action: "updated" as SSEAction,
        session_id: event.session_id,
      }
  }
}

// ============================================================================
// SSE Response Headers (§6.5)
// ============================================================================

const SSE_HEADERS: Record<string, string> = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
}

// ============================================================================
// createStreamHandler — SSE Endpoint Handler Factory
// ============================================================================

/**
 * Create a handler function for the SSE stream endpoint.
 *
 * The handler:
 * 1. Calls broadcaster.addClient() to get a ReadableStream
 * 2. Returns a Response with proper SSE headers
 * 3. The stream auto-removes the client when cancelled (via broadcaster internals)
 *
 * @param broadcaster - SSEBroadcaster instance for managing connections
 * @returns A function that takes a Request and returns a Response
 */
export function createStreamHandler(
  broadcaster: SSEBroadcaster
): (request: Request) => Promise<Response> {
  return async (_request: Request): Promise<Response> => {
    const stream = broadcaster.addClient()

    return new Response(stream, {
      status: 200,
      headers: SSE_HEADERS,
    })
  }
}

// ============================================================================
// registerStreamRoutes — Route Registration
// ============================================================================

/**
 * Register the SSE stream route on the API router.
 *
 * Route: GET /api/v1/events/stream
 *
 * @param router - APIRouter instance
 * @param broadcaster - SSEBroadcaster instance
 */
export function registerStreamRoutes(
  router: APIRouter,
  broadcaster: SSEBroadcaster
): void {
  const handler = createStreamHandler(broadcaster)

  router.get("/api/v1/events/stream", async (req) => {
    return handler(req.request)
  })
}
