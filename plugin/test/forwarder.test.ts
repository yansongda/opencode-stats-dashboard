import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { forwardEvent } from "../src/http/forwarder"
import type { IngestEventEnvelope } from "../src/types"

// ---------------------------------------------------------------------------
// Helpers — minimal event fixture and in-process test server
// ---------------------------------------------------------------------------

function validEvent(): IngestEventEnvelope {
  return {
    event_id: "evt_forwarder_test_001",
    event_type: "session.created",
    session_id: "ses_test_001",
    project_path: "/tmp/test",
    timestamp_ms: 1717400000000,
    model: "claude-sonnet-4-20250514",
    tokens: 0,
    cost_usd: 0,
    tool: null,
    status: null,
    summary: null,
    deleted: false,
    metadata: {},
  }
}

/**
 * Spin up a lightweight Bun server for a single test.
 *
 * The `handler` callback receives the parsed request body and
 * returns the response JSON + status to send back.
 */
function createTestServer(
  handler: (body: unknown) => { status?: number; json: unknown },
) {
  return Bun.serve({
    port: 0, // random available port
    fetch: async (req) => {
      const body = await req.json()
      const { status = 200, json } = handler(body)
      return new Response(JSON.stringify(json), {
        status,
        headers: { "Content-Type": "application/json" },
      })
    },
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("forwardEvent", () => {
  let server: ReturnType<typeof Bun.serve> | null = null

  afterEach(async () => {
    if (server) {
      server.stop(true)
      server = null
    }
  })

  test("accepted event returns { ok: true, duplicate: false }", async () => {
    let receivedBody: unknown = null

    server = createTestServer((body) => {
      receivedBody = body
      return {
        json: { accepted: true, duplicate: false },
      }
    })

    const result = await forwardEvent(
      validEvent(),
      `http://127.0.0.1:${server.port}`,
    )

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.duplicate).toBe(false)
    }
    // verify the event was actually POSTed
    expect(receivedBody).toBeDefined()
    expect((receivedBody as IngestEventEnvelope).event_id).toBe(
      "evt_forwarder_test_001",
    )
  })

  test("duplicate event returns { ok: true, duplicate: true }", async () => {
    server = createTestServer(() => ({
      json: { accepted: true, duplicate: true },
    }))

    const result = await forwardEvent(
      validEvent(),
      `http://127.0.0.1:${server.port}`,
    )

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.duplicate).toBe(true)
    }
  })

  test("HTTP 400 returns { ok: false } with status", async () => {
    server = createTestServer(() => ({
      status: 400,
      json: { accepted: false, error: "invalid_json" },
    }))

    const result = await forwardEvent(
      validEvent(),
      `http://127.0.0.1:${server.port}`,
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(400)
      expect(result.error).toBe("HTTP 400")
    }
  })

  test("HTTP 500 returns { ok: false }", async () => {
    server = createTestServer(() => ({
      status: 500,
      json: { accepted: false, error: "database_error" },
    }))

    const result = await forwardEvent(
      validEvent(),
      `http://127.0.0.1:${server.port}`,
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(500)
    }
  })

  test("connection refused returns { ok: false } — never throws", async () => {
    // Use a port that is guaranteed to have nothing listening
    const result = await forwardEvent(
      validEvent(),
      "http://127.0.0.1:1",
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBeDefined()
      expect(result.error.length).toBeGreaterThan(0)
    }
  })

  test("sidecar_rejected when accepted=false in 200 body", async () => {
    server = createTestServer(() => ({
      json: { accepted: false, error: "full_payload_not_allowed" },
    }))

    const result = await forwardEvent(
      validEvent(),
      `http://127.0.0.1:${server.port}`,
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe("sidecar_rejected")
    }
  })

  test("trailing slashes in sidecarUrl are normalised", async () => {
    let requestUrl = ""

    server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        requestUrl = new URL(req.url).pathname
        return new Response(
          JSON.stringify({ accepted: true, duplicate: false }),
          { headers: { "Content-Type": "application/json" } },
        )
      },
    })

    const result = await forwardEvent(
      validEvent(),
      `http://127.0.0.1:${server.port}/`,
    )

    expect(result.ok).toBe(true)
    expect(requestUrl).toBe("/ingest/event")
  })
})
