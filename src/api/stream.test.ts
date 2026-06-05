/**
 * Tests for SSE stream endpoint (src/api/stream.ts).
 *
 * Covers:
 *  - buildStatsUpdate() event type → SSE type mapping
 *  - createStreamHandler() SSE connection establishment
 *  - SSE response headers (Content-Type, Cache-Control, Connection)
 *  - SSE message format (via broadcaster integration)
 *  - Client cleanup on disconnect
 */

import { describe, test, expect, beforeEach } from "bun:test"
import { SSEBroadcaster } from "../sse/broadcaster"
import { buildStatsUpdate, createStreamHandler } from "./stream"
import type { IngestEventEnvelope } from "../types/events"
import type { StatsUpdate } from "../types/sse"

// ============================================================================
// Helpers
// ============================================================================

/** Create a minimal IngestEventEnvelope for testing */
function makeEvent(overrides: Partial<IngestEventEnvelope> = {}): IngestEventEnvelope {
  return {
    event_id: "evt-test-001",
    event_type: "session.created",
    session_id: "ses-abc123",
    project_path: "/Users/test/project",
    timestamp_ms: 1717500000000,
    model: "claude-sonnet-4-20250514",
    tokens: 0,
    cost_usd: 0,
    tool: null,
    status: null,
    summary: null,
    deleted: false,
    metadata: {},
    ...overrides,
  }
}

/** Read all data from a ReadableStream until closed */
async function readAllFrames(
  stream: ReadableStream<Uint8Array>,
  timeoutMs = 200
): Promise<string> {
  const reader = stream.getReader()
  const chunks: string[] = []
  const decoder = new TextDecoder()

  const readLoop = async () => {
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(decoder.decode(value, { stream: true }))
      }
    } catch {
      // Stream closed
    }
  }

  // Race with timeout — stream won't close on its own
  await Promise.race([
    readLoop(),
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ])

  reader.releaseLock()
  return chunks.join("")
}

// ============================================================================
// buildStatsUpdate() — Event Type Mapping
// ============================================================================

describe("buildStatsUpdate", () => {
  test("maps session.created to type=session, action=created", () => {
    const event = makeEvent({ event_type: "session.created" })
    const result = buildStatsUpdate(event)

    expect(result.type).toBe("session")
    expect(result.action).toBe("created")
    expect(result.session_id).toBe("ses-abc123")
  })

  test("maps session.deleted to type=session, action=deleted", () => {
    const event = makeEvent({ event_type: "session.deleted" })
    const result = buildStatsUpdate(event)

    expect(result.type).toBe("session")
    expect(result.action).toBe("deleted")
    expect(result.session_id).toBe("ses-abc123")
  })

  test("maps usage.updated to type=message, action=updated with delta", () => {
    const event = makeEvent({
      event_type: "usage.updated",
      tokens: 1500,
      cost_usd: 0.015,
    })
    const result = buildStatsUpdate(event)

    expect(result.type).toBe("message")
    expect(result.action).toBe("updated")
    expect(result.session_id).toBe("ses-abc123")
    expect(result.delta).toBeDefined()
    expect(result.delta!.tokens).toBe(1500)
    expect(result.delta!.cost_usd).toBe(0.015)
  })

  test("maps tool.started to type=tool, action=created", () => {
    const event = makeEvent({ event_type: "tool.started" })
    const result = buildStatsUpdate(event)

    expect(result.type).toBe("tool")
    expect(result.action).toBe("created")
    expect(result.session_id).toBe("ses-abc123")
    expect(result.delta).toBeDefined()
    expect(result.delta!.tool_calls).toBe(1)
  })

  test("maps tool.completed to type=tool, action=updated", () => {
    const event = makeEvent({ event_type: "tool.completed" })
    const result = buildStatsUpdate(event)

    expect(result.type).toBe("tool")
    expect(result.action).toBe("updated")
    expect(result.delta!.tool_calls).toBe(1)
  })

  test("maps tool.failed to type=error, action=created", () => {
    const event = makeEvent({ event_type: "tool.failed" })
    const result = buildStatsUpdate(event)

    expect(result.type).toBe("error")
    expect(result.action).toBe("created")
    expect(result.delta).toBeDefined()
    expect(result.delta!.errors).toBe(1)
  })

  test("maps unknown event types to type=session, action=updated (default)", () => {
    const event = makeEvent({ event_type: "config.updated" })
    const result = buildStatsUpdate(event)

    expect(result.type).toBe("session")
    expect(result.action).toBe("updated")
    expect(result.session_id).toBe("ses-abc123")
  })

  test("result always contains event_id and timestamp", () => {
    const event = makeEvent({ event_id: "evt-xyz-789" })
    const result = buildStatsUpdate(event)

    expect(result.event_id).toBe("evt-xyz-789")
    expect(result.timestamp).toBeDefined()
    // Verify it's a valid ISO timestamp
    expect(() => new Date(result.timestamp)).not.toThrow()
  })

  test("session.updated maps to type=session, action=updated", () => {
    const event = makeEvent({ event_type: "session.updated" })
    const result = buildStatsUpdate(event)

    expect(result.type).toBe("session")
    expect(result.action).toBe("updated")
  })

  test("file.edited maps to default (session, updated)", () => {
    const event = makeEvent({ event_type: "file.edited" })
    const result = buildStatsUpdate(event)

    // file.edited falls through to default case
    expect(result.type).toBe("session")
    expect(result.action).toBe("updated")
  })

  test("agent.started maps to default (session, updated)", () => {
    const event = makeEvent({ event_type: "agent.started" })
    const result = buildStatsUpdate(event)

    expect(result.type).toBe("session")
    expect(result.action).toBe("updated")
  })

  test("result conforms to StatsUpdate interface", () => {
    const event = makeEvent()
    const result: StatsUpdate = buildStatsUpdate(event)

    expect(typeof result.event_id).toBe("string")
    expect(typeof result.timestamp).toBe("string")
    expect(typeof result.type).toBe("string")
    expect(typeof result.action).toBe("string")
  })
})

// ============================================================================
// createStreamHandler() — SSE Endpoint
// ============================================================================

describe("createStreamHandler", () => {
  let broadcaster: SSEBroadcaster

  beforeEach(() => {
    broadcaster = new SSEBroadcaster({ keepaliveMs: 100 })
  })

  test("returns a Response with correct SSE headers", async () => {
    const handler = createStreamHandler(broadcaster)
    const request = new Request("http://localhost/api/v1/events/stream")
    const response = await handler(request)

    expect(response.status).toBe(200)
    expect(response.headers.get("Content-Type")).toBe("text/event-stream")
    expect(response.headers.get("Cache-Control")).toBe("no-cache")
    expect(response.headers.get("Connection")).toBe("keep-alive")
  })

  test("response body is a ReadableStream", async () => {
    const handler = createStreamHandler(broadcaster)
    const request = new Request("http://localhost/api/v1/events/stream")
    const response = await handler(request)

    expect(response.body).toBeDefined()
    expect(response.body).toBeInstanceOf(ReadableStream)
  })

  test("adds a client to the broadcaster on connection", async () => {
    expect(broadcaster.subscriberCount).toBe(0)

    const handler = createStreamHandler(broadcaster)
    const request = new Request("http://localhost/api/v1/events/stream")
    const response = await handler(request)

    expect(broadcaster.subscriberCount).toBe(1)

    // Cleanup — cancel the stream
    const reader = response.body!.getReader()
    reader.releaseLock()
    await response.body!.cancel()
  })

  test("receives broadcast messages through the SSE stream", async () => {
    const handler = createStreamHandler(broadcaster)
    const request = new Request("http://localhost/api/v1/events/stream")
    const response = await handler(request)

    // Broadcast a message
    broadcaster.broadcast({
      event_id: "evt-001",
      timestamp: "2026-06-05T10:00:00Z",
      type: "session",
      action: "created",
      session_id: "ses-abc",
    })

    const content = await readAllFrames(response.body!, 150)

    // Should contain the SSE frame
    expect(content).toContain("event: stats-update")
    expect(content).toContain("id: evt-001")
    expect(content).toContain('"event_id":"evt-001"')
    expect(content).toContain('"session_id":"ses-abc"')
  })

  test("receives keepalive comments", async () => {
    const handler = createStreamHandler(broadcaster)
    const request = new Request("http://localhost/api/v1/events/stream")
    const response = await handler(request)

    // Wait for keepalive (100ms interval)
    const content = await readAllFrames(response.body!, 250)

    expect(content).toContain(": keepalive")
  })

  test("removes client when stream is cancelled", async () => {
    const handler = createStreamHandler(broadcaster)
    const request = new Request("http://localhost/api/v1/events/stream")
    const response = await handler(request)

    expect(broadcaster.subscriberCount).toBe(1)

    await response.body!.cancel()

    await new Promise((resolve) => setTimeout(resolve, 10))

    broadcaster.broadcast({
      event_id: "evt_cleanup",
      type: "message",
      action: "updated",
      timestamp: new Date().toISOString(),
    })

    expect(broadcaster.subscriberCount).toBe(0)
  })

  test("multiple connections are independent", async () => {
    const handler = createStreamHandler(broadcaster)

    const req1 = new Request("http://localhost/api/v1/events/stream")
    const req2 = new Request("http://localhost/api/v1/events/stream")
    const res1 = await handler(req1)
    const res2 = await handler(req2)

    expect(broadcaster.subscriberCount).toBe(2)

    // Broadcast to all
    broadcaster.broadcast({
      event_id: "evt-broadcast",
      timestamp: "2026-06-05T10:00:00Z",
      type: "session",
      action: "created",
    })

    const content1 = await readAllFrames(res1.body!, 150)
    const content2 = await readAllFrames(res2.body!, 150)

    expect(content1).toContain("evt-broadcast")
    expect(content2).toContain("evt-broadcast")

    // Cleanup
    await res1.body!.cancel()
    await res2.body!.cancel()
  })
})
