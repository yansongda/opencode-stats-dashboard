/**
 * API Router — lightweight route registration and request handling for Bun.serve().
 *
 * Features:
 *  - Path parameter extraction (`:id` syntax)
 *  - Query string parsing
 *  - JSON response helpers
 *  - CORS headers on every response
 *  - Automatic error handling (catches throws → 500 JSON)
 *
 * Does NOT use Express/Koa — designed for direct use with Bun.serve().
 */

import type { ApiResponse, ApiError } from "../types/api"

// ============================================================================
// Types
// ============================================================================

/** Parsed request with path params and query string */
export interface ParsedRequest {
  /** Original Request object */
  request: Request
  /** Path parameters (e.g. { id: "ses_abc" }) */
  params: Record<string, string>
  /** Query string parameters */
  query: URLSearchParams
}

/** Response helpers passed to route handlers */
export interface ResponseHelpers {
  /** Create a JSON response */
  json(data: unknown, status?: number): Response
  /** Create an error response */
  error(error: string, status: number, message?: string): Response
}

/** Route handler function signature */
export type RouteHandler = (
  req: ParsedRequest,
  res: ResponseHelpers
) => Response | Promise<Response>

/** Internal route entry */
interface RouteEntry {
  method: string
  /** Original path pattern (for debugging) */
  path: string
  /** Compiled URLPattern for matching */
  pattern: URLPattern
  handler: RouteHandler
}

// ============================================================================
// Constants
// ============================================================================

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept",
  "Access-Control-Max-Age": "86400",
}

const JSON_CONTENT_TYPE = { "Content-Type": "application/json" }

// ============================================================================
// Response Helpers
// ============================================================================

/**
 * Add CORS headers to an existing Response (creates a new Response with merged headers).
 */
function addCorsHeaders(response: Response): Response {
  const headers = new Headers(response.headers)
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    if (!headers.has(key)) {
      headers.set(key, value)
    }
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function createResponseHelpers(): ResponseHelpers {
  return {
    json(data: unknown, status = 200): Response {
      return new Response(JSON.stringify(data), {
        status,
        headers: { ...JSON_CONTENT_TYPE, ...CORS_HEADERS },
      })
    },

    error(error: string, status: number, message?: string): Response {
      const body: ApiError = { error }
      if (message !== undefined) {
        body["message"] = message
      }
      return new Response(JSON.stringify(body), {
        status,
        headers: { ...JSON_CONTENT_TYPE, ...CORS_HEADERS },
      })
    },
  }
}

// ============================================================================
// APIRouter
// ============================================================================

export class APIRouter {
  private routes: RouteEntry[] = []

  // =========================================================================
  // Route Registration
  // =========================================================================

  /**
   * Register a GET route handler.
   */
  get(path: string, handler: RouteHandler): void {
    this.addRoute("GET", path, handler)
  }

  /**
   * Register a POST route handler.
   */
  post(path: string, handler: RouteHandler): void {
    this.addRoute("POST", path, handler)
  }

  /**
   * Register a PUT route handler.
   */
  put(path: string, handler: RouteHandler): void {
    this.addRoute("PUT", path, handler)
  }

  /**
   * Register a DELETE route handler.
   */
  delete(path: string, handler: RouteHandler): void {
    this.addRoute("DELETE", path, handler)
  }

  /**
   * Register a PATCH route handler.
   */
  patch(path: string, handler: RouteHandler): void {
    this.addRoute("PATCH", path, handler)
  }

  // =========================================================================
  // Request Handling
  // =========================================================================

  /**
   * Main request handler — intended for use with Bun.serve().
   *
   * 1. Handle OPTIONS preflight
   * 2. Match route by method + path pattern
   * 3. Parse path params and query string
   * 4. Execute handler with error boundary
   * 5. Return 404/405 for unmatched routes
   */
  async handle(request: Request): Promise<Response> {
    // OPTIONS preflight — return 204 with CORS headers
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS })
    }

    const url = new URL(request.url)
    const pathname = url.pathname
    const method = request.method

    // Try to match a route
    const matched = this.matchRoute(method, pathname)

    if (matched) {
      const { entry, params } = matched
      const parsedRequest: ParsedRequest = {
        request,
        params,
        query: url.searchParams,
      }
      const res = createResponseHelpers()

      try {
        const response = await entry.handler(parsedRequest, res)
        return addCorsHeaders(response)
      } catch (err) {
        // Catch handler errors — return 500
        const message = err instanceof Error ? err.message : "Unknown error"
        return res.error("Internal Server Error", 500, message)
      }
    }

    // No route matched — check if path exists with wrong method
    const pathExists = this.routes.some((r) => r.pattern.test({ pathname }))

    if (pathExists) {
      // Path exists but method doesn't match — 405
      const res = createResponseHelpers()
      return res.error("Method Not Allowed", 405)
    }

    // Path doesn't exist at all — 404
    const res = createResponseHelpers()
    return res.error("Not Found", 404)
  }

  // =========================================================================
  // Internal
  // =========================================================================

  private addRoute(method: string, path: string, handler: RouteHandler): void {
    // Convert Express-style path params (:id) to URLPattern syntax
    // /api/v1/stats/sessions/:id → /api/v1/stats/sessions/:id
    // URLPattern natively supports :param syntax
    const pattern = new URLPattern({ pathname: path })
    this.routes.push({ method, path, pattern, handler })
  }

  /**
   * Find the first route matching the given method and pathname.
   * Returns the matched entry + extracted path params, or null.
   */
  private matchRoute(
    method: string,
    pathname: string
  ): { entry: RouteEntry; params: Record<string, string> } | null {
    for (const entry of this.routes) {
      if (entry.method !== method) continue

      const match = entry.pattern.exec({ pathname })
      if (match) {
        // URLPattern returns named groups in match.pathname.groups
        const params: Record<string, string> = {}
        for (const [key, value] of Object.entries(match.pathname.groups)) {
          if (value !== undefined) {
            params[key] = value
          }
        }
        return { entry, params }
      }
    }
    return null
  }
}
