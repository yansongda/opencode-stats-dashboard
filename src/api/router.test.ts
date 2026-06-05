/**
 * Tests for APIRouter — route registration, request parsing, response formatting,
 * error handling, and CORS support.
 */

import { describe, test, expect, beforeEach } from "bun:test"
import { APIRouter } from "./router"
import type { ParsedRequest, RouteHandler } from "./router"

// ============================================================================
// Helper: create a minimal Request
// ============================================================================

function makeRequest(path: string, init?: RequestInit): Request {
  return new Request(`http://localhost${path}`, init)
}

// ============================================================================
// Route Registration
// ============================================================================

describe("APIRouter - Route Registration", () => {
  let router: APIRouter

  beforeEach(() => {
    router = new APIRouter()
  })

  test("registers GET routes and matches them", async () => {
    router.get("/api/v1/stats/overview", () => {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      })
    })

    const res = await router.handle(makeRequest("/api/v1/stats/overview"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true })
  })

  test("registers POST routes and matches them", async () => {
    router.post("/api/v1/ingest", () => {
      return new Response(JSON.stringify({ accepted: 1 }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      })
    })

    const res = await router.handle(makeRequest("/api/v1/ingest", { method: "POST" }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body).toEqual({ accepted: 1 })
  })

  test("returns 405 for wrong method on existing path", async () => {
    router.get("/api/v1/stats/overview", () => new Response("ok"))

    const res = await router.handle(makeRequest("/api/v1/stats/overview", { method: "POST" }))
    expect(res.status).toBe(405)
  })

  test("returns 404 for unmatched routes", async () => {
    router.get("/api/v1/stats/overview", () => new Response("ok"))

    const res = await router.handle(makeRequest("/api/v1/nonexistent"))
    expect(res.status).toBe(404)
  })

  test("matches path parameters", async () => {
    router.get("/api/v1/stats/sessions/:id", (req) => {
      return new Response(JSON.stringify({ id: req.params["id"] }), {
        headers: { "Content-Type": "application/json" },
      })
    })

    const res = await router.handle(makeRequest("/api/v1/stats/sessions/ses_abc123"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ id: "ses_abc123" })
  })

  test("supports multiple path parameters", async () => {
    router.get("/api/v1/projects/:project/sessions/:id", (req) => {
      return new Response(
        JSON.stringify({
          project: req.params["project"],
          id: req.params["id"],
        }),
        { headers: { "Content-Type": "application/json" } }
      )
    })

    const res = await router.handle(makeRequest("/api/v1/projects/my-proj/sessions/ses_001"))
    const body = await res.json()
    expect(body).toEqual({ project: "my-proj", id: "ses_001" })
  })

  test("router is reusable — multiple routes coexist", async () => {
    router.get("/api/v1/stats/overview", () => new Response("overview"))
    router.get("/api/v1/stats/trend", () => new Response("trend"))
    router.get("/api/v1/stats/sessions", () => new Response("sessions"))

    const res1 = await router.handle(makeRequest("/api/v1/stats/overview"))
    const res2 = await router.handle(makeRequest("/api/v1/stats/trend"))
    const res3 = await router.handle(makeRequest("/api/v1/stats/sessions"))

    expect(await res1.text()).toBe("overview")
    expect(await res2.text()).toBe("trend")
    expect(await res3.text()).toBe("sessions")
  })
})

// ============================================================================
// Request Parsing
// ============================================================================

describe("APIRouter - Request Parsing", () => {
  let router: APIRouter

  beforeEach(() => {
    router = new APIRouter()
  })

  test("parses query parameters", async () => {
    let capturedQuery: URLSearchParams | undefined

    router.get("/api/v1/stats/trend", (req) => {
      capturedQuery = req.query
      return new Response("ok")
    })

    await router.handle(makeRequest("/api/v1/stats/trend?start=2026-06-01&end=2026-06-04"))

    expect(capturedQuery).toBeDefined()
    expect(capturedQuery!.get("start")).toBe("2026-06-01")
    expect(capturedQuery!.get("end")).toBe("2026-06-04")
  })

  test("parses numeric query parameters", async () => {
    let capturedQuery: URLSearchParams | undefined

    router.get("/api/v1/stats/sessions", (req) => {
      capturedQuery = req.query
      return new Response("ok")
    })

    await router.handle(makeRequest("/api/v1/stats/sessions?limit=10&offset=20"))

    expect(capturedQuery!.get("limit")).toBe("10")
    expect(capturedQuery!.get("offset")).toBe("20")
  })

  test("handles empty query string", async () => {
    let capturedQuery: URLSearchParams | undefined

    router.get("/api/v1/stats/overview", (req) => {
      capturedQuery = req.query
      return new Response("ok")
    })

    await router.handle(makeRequest("/api/v1/stats/overview"))

    expect(capturedQuery).toBeDefined()
    expect(capturedQuery!.toString()).toBe("")
  })

  test("provides original Request object", async () => {
    let capturedRequest: Request | undefined

    router.post("/api/v1/ingest", (req) => {
      capturedRequest = req.request
      return new Response("ok")
    })

    await router.handle(makeRequest("/api/v1/ingest", { method: "POST" }))

    expect(capturedRequest).toBeDefined()
    expect(capturedRequest!.method).toBe("POST")
  })

  test("preserves path params and query params together", async () => {
    let captured: { params: Record<string, string>; query: URLSearchParams } | undefined

    router.get("/api/v1/stats/sessions/:id", (req) => {
      captured = { params: req.params, query: req.query }
      return new Response("ok")
    })

    await router.handle(makeRequest("/api/v1/stats/sessions/ses_001?include=details"))

    expect(captured!.params["id"]).toBe("ses_001")
    expect(captured!.query.get("include")).toBe("details")
  })
})

// ============================================================================
// Response Formatting
// ============================================================================

describe("APIRouter - Response Formatting", () => {
  test("json() helper creates JSON response with correct headers", async () => {
    const router = new APIRouter()

    router.get("/api/v1/test", (_req, res) => {
      return res.json({ hello: "world" })
    })

    const response = await router.handle(makeRequest("/api/v1/test"))
    expect(response.status).toBe(200)
    expect(response.headers.get("Content-Type")).toBe("application/json")
    const body = await response.json()
    expect(body).toEqual({ hello: "world" })
  })

  test("json() helper supports custom status code", async () => {
    const router = new APIRouter()

    router.post("/api/v1/test", (_req, res) => {
      return res.json({ created: true }, 201)
    })

    const response = await router.handle(makeRequest("/api/v1/test", { method: "POST" }))
    expect(response.status).toBe(201)
  })

  test("error() helper creates error response", async () => {
    const router = new APIRouter()

    router.get("/api/v1/test", (_req, res) => {
      return res.error("Not Found", 404)
    })

    const response = await router.handle(makeRequest("/api/v1/test"))
    expect(response.status).toBe(404)
    expect(response.headers.get("Content-Type")).toBe("application/json")
    const body = await response.json()
    expect(body).toHaveProperty("error", "Not Found")
  })

  test("error() helper supports optional message", async () => {
    const router = new APIRouter()

    router.get("/api/v1/test", (_req, res) => {
      return res.error("Bad Request", 400, "Missing required parameter: start")
    })

    const response = await router.handle(makeRequest("/api/v1/test"))
    const body = await response.json()
    expect(body).toEqual({
      error: "Bad Request",
      message: "Missing required parameter: start",
    })
  })
})

// ============================================================================
// Error Handling
// ============================================================================

describe("APIRouter - Error Handling", () => {
  test("catches synchronous handler errors and returns 500", async () => {
    const router = new APIRouter()

    router.get("/api/v1/broken", () => {
      throw new Error("Something went wrong")
    })

    const response = await router.handle(makeRequest("/api/v1/broken"))
    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body).toHaveProperty("error", "Internal Server Error")
  })

  test("catches async handler errors and returns 500", async () => {
    const router = new APIRouter()

    router.get("/api/v1/async-broken", async () => {
      throw new Error("Async failure")
    })

    const response = await router.handle(makeRequest("/api/v1/async-broken"))
    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body).toHaveProperty("error", "Internal Server Error")
  })

  test("error response includes CORS headers", async () => {
    const router = new APIRouter()

    router.get("/api/v1/broken", () => {
      throw new Error("fail")
    })

    const response = await router.handle(makeRequest("/api/v1/broken"))
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*")
  })

  test("error response is always JSON", async () => {
    const router = new APIRouter()

    router.get("/api/v1/broken", () => {
      throw new Error("fail")
    })

    const response = await router.handle(makeRequest("/api/v1/broken"))
    expect(response.headers.get("Content-Type")).toBe("application/json")
    // Should not throw on json parse
    const body = await response.json()
    expect(body).toHaveProperty("error")
  })
})

// ============================================================================
// CORS Support
// ============================================================================

describe("APIRouter - CORS Support", () => {
  test("all responses include CORS headers", async () => {
    const router = new APIRouter()

    router.get("/api/v1/test", () => new Response("ok"))

    const response = await router.handle(makeRequest("/api/v1/test"))
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*")
    expect(response.headers.get("Access-Control-Allow-Methods")).toContain("GET")
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain("Content-Type")
  })

  test("handles OPTIONS preflight requests", async () => {
    const router = new APIRouter()

    router.get("/api/v1/test", () => new Response("ok"))

    const response = await router.handle(makeRequest("/api/v1/test", { method: "OPTIONS" }))
    expect(response.status).toBe(204)
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*")
  })

  test("preflight returns correct allowed methods", async () => {
    const router = new APIRouter()

    router.get("/api/v1/test", () => new Response("ok"))
    router.post("/api/v1/test", () => new Response("ok"))

    const response = await router.handle(makeRequest("/api/v1/test", { method: "OPTIONS" }))
    const methods = response.headers.get("Access-Control-Allow-Methods") ?? ""
    expect(methods).toContain("GET")
    expect(methods).toContain("POST")
  })
})

// ============================================================================
// Integration: Handler receives ParsedRequest correctly
// ============================================================================

describe("APIRouter - Integration", () => {
  test("full request lifecycle: path params + query + JSON response", async () => {
    const router = new APIRouter()

    router.get("/api/v1/stats/sessions/:id", (req, res) => {
      const { id } = req.params
      const include = req.query.get("include")

      return res.json({
        session_id: id,
        include_details: include === "details",
        parsed_at: "test",
      })
    })

    const response = await router.handle(
      makeRequest("/api/v1/stats/sessions/ses_abc123?include=details")
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("Content-Type")).toBe("application/json")
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*")

    const body = await response.json()
    expect(body).toEqual({
      session_id: "ses_abc123",
      include_details: true,
      parsed_at: "test",
    })
  })

  test("POST route with JSON body parsing pattern", async () => {
    const router = new APIRouter()

    router.post("/api/v1/ingest", async (req, res) => {
      const body = await req.request.json()
      const events = (body as { events: unknown[] }).events ?? []
      return res.json({ accepted: events.length }, 201)
    })

    const response = await router.handle(
      makeRequest("/api/v1/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events: [{ id: "1" }, { id: "2" }] }),
      })
    )

    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body).toEqual({ accepted: 2 })
  })

  test("404 response includes CORS headers and JSON body", async () => {
    const router = new APIRouter()

    const response = await router.handle(makeRequest("/api/v1/does-not-exist"))

    expect(response.status).toBe(404)
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*")
    expect(response.headers.get("Content-Type")).toBe("application/json")
    const body = await response.json()
    expect(body).toHaveProperty("error", "Not Found")
  })

  test("405 response includes CORS headers and JSON body", async () => {
    const router = new APIRouter()
    router.get("/api/v1/stats/overview", () => new Response("ok"))

    const response = await router.handle(
      makeRequest("/api/v1/stats/overview", { method: "DELETE" })
    )

    expect(response.status).toBe(405)
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*")
    const body = await response.json()
    expect(body).toHaveProperty("error", "Method Not Allowed")
  })
})
