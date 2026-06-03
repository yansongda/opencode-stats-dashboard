import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "node:path"
import { SpoolManager } from "../src/spool"
import type { IngestEventEnvelope } from "../src/types"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validEvent(overrides?: Partial<IngestEventEnvelope>): IngestEventEnvelope {
  return {
    event_id: "evt_spool_test_001",
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
    ...overrides,
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

describe("SpoolManager", () => {
  let spoolDir: string
  let manager: SpoolManager

  beforeEach(async () => {
    // Use a unique temp directory for each test
    spoolDir = join(
      "/tmp",
      `spool-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    await Bun.write(join(spoolDir, ".gitkeep"), "")
    manager = new SpoolManager({ spoolDir })
  })

  afterEach(async () => {
    // Clean up spool directory
    try {
      const proc = Bun.spawn(["rm", "-rf", spoolDir])
      await proc.exited
    } catch {
      // Ignore cleanup errors
    }
  })

  // -------------------------------------------------------------------------
  // spool() tests
  // -------------------------------------------------------------------------

  test("spool() writes event to JSONL file", async () => {
    const event = validEvent()
    const result = await manager.spool(event)

    expect(result.ok).toBe(true)
    expect(result.path).toContain("events.jsonl")

    // Verify file content
    const content = await Bun.file(result.path).text()
    const lines = content.trim().split("\n")
    expect(lines.length).toBe(1)

    const parsed = JSON.parse(lines[0]) as IngestEventEnvelope
    expect(parsed.event_id).toBe("evt_spool_test_001")
  })

  test("spool() appends multiple events as separate lines", async () => {
    const event1 = validEvent({ event_id: "evt_001" })
    const event2 = validEvent({ event_id: "evt_002" })
    const event3 = validEvent({ event_id: "evt_003" })

    await manager.spool(event1)
    await manager.spool(event2)
    await manager.spool(event3)

    const spoolPath = join(spoolDir, "events.jsonl")
    const content = await Bun.file(spoolPath).text()
    const lines = content.trim().split("\n")
    expect(lines.length).toBe(3)

    // Verify order is preserved
    const parsed1 = JSON.parse(lines[0]) as IngestEventEnvelope
    const parsed2 = JSON.parse(lines[1]) as IngestEventEnvelope
    const parsed3 = JSON.parse(lines[2]) as IngestEventEnvelope
    expect(parsed1.event_id).toBe("evt_001")
    expect(parsed2.event_id).toBe("evt_002")
    expect(parsed3.event_id).toBe("evt_003")
  })

  // -------------------------------------------------------------------------
  // drain() tests — sidecar available
  // -------------------------------------------------------------------------

  test("drain() forwards all events and clears file when sidecar accepts", async () => {
    // Spool three events
    await manager.spool(validEvent({ event_id: "evt_drain_001" }))
    await manager.spool(validEvent({ event_id: "evt_drain_002" }))
    await manager.spool(validEvent({ event_id: "evt_drain_003" }))

    // Start a test server that accepts all events
    const receivedIds: string[] = []
    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        const body = (await req.json()) as IngestEventEnvelope
        receivedIds.push(body.event_id)
        return new Response(
          JSON.stringify({ accepted: true, duplicate: false }),
          { headers: { "Content-Type": "application/json" } },
        )
      },
    })

    try {
      const result = await manager.drain(`http://127.0.0.1:${server.port}`)

      expect(result.forwarded).toBe(3)
      expect(result.duplicates).toBe(0)
      expect(result.failed).toBe(0)

      // Verify events were forwarded in order
      expect(receivedIds).toEqual(["evt_drain_001", "evt_drain_002", "evt_drain_003"])

      // Verify spool file is cleared
      const hasPending = await manager.hasPending()
      expect(hasPending).toBe(false)
    } finally {
      server.stop(true)
    }
  })

  test("drain() treats duplicate events as success", async () => {
    await manager.spool(validEvent({ event_id: "evt_dup_001" }))

    // Server returns duplicate: true
    const server = Bun.serve({
      port: 0,
      fetch: async () => {
        return new Response(
          JSON.stringify({ accepted: true, duplicate: true }),
          { headers: { "Content-Type": "application/json" } },
        )
      },
    })

    try {
      const result = await manager.drain(`http://127.0.0.1:${server.port}`)

      expect(result.forwarded).toBe(0)
      expect(result.duplicates).toBe(1)
      expect(result.failed).toBe(0)

      // Spool file should be cleared (duplicates count as success)
      const hasPending = await manager.hasPending()
      expect(hasPending).toBe(false)
    } finally {
      server.stop(true)
    }
  })

  test("drain() returns zeros when no spool file exists", async () => {
    const result = await manager.drain("http://127.0.0.1:1")
    expect(result.forwarded).toBe(0)
    expect(result.duplicates).toBe(0)
    expect(result.failed).toBe(0)
  })

  // -------------------------------------------------------------------------
  // drain() tests — sidecar unavailable / partial failure
  // -------------------------------------------------------------------------

  test("drain()保留 failed events when sidecar rejects some", async () => {
    // Spool three events
    await manager.spool(validEvent({ event_id: "evt_partial_001" }))
    await manager.spool(validEvent({ event_id: "evt_partial_002" }))
    await manager.spool(validEvent({ event_id: "evt_partial_003" }))

    // Server rejects the second event
    let callCount = 0
    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        callCount++
        const body = (await req.json()) as IngestEventEnvelope
        if (body.event_id === "evt_partial_002") {
          return new Response(
            JSON.stringify({ accepted: false, error: "rejected" }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          )
        }
        return new Response(
          JSON.stringify({ accepted: true, duplicate: false }),
          { headers: { "Content-Type": "application/json" } },
        )
      },
    })

    try {
      const result = await manager.drain(`http://127.0.0.1:${server.port}`)

      expect(result.forwarded).toBe(2)
      expect(result.duplicates).toBe(0)
      expect(result.failed).toBe(1)

      // Spool file should保留 only the failed event
      const hasPending = await manager.hasPending()
      expect(hasPending).toBe(true)

      const spoolPath = join(spoolDir, "events.jsonl")
      const content = await Bun.file(spoolPath).text()
      const lines = content.trim().split("\n")
      expect(lines.length).toBe(1)

      const parsed = JSON.parse(lines[0]) as IngestEventEnvelope
      expect(parsed.event_id).toBe("evt_partial_002")
    } finally {
      server.stop(true)
    }
  })

  test("drain()保留 all events when sidecar is completely unreachable", async () => {
    await manager.spool(validEvent({ event_id: "evt_unreach_001" }))
    await manager.spool(validEvent({ event_id: "evt_unreach_002" }))

    // Use a port that is guaranteed to have nothing listening
    const result = await manager.drain("http://127.0.0.1:1")

    expect(result.forwarded).toBe(0)
    expect(result.duplicates).toBe(0)
    expect(result.failed).toBe(2)

    // All events should be保留 for retry
    const hasPending = await manager.hasPending()
    expect(hasPending).toBe(true)

    const spoolPath = join(spoolDir, "events.jsonl")
    const content = await Bun.file(spoolPath).text()
    const lines = content.trim().split("\n")
    expect(lines.length).toBe(2)
  })

  // -------------------------------------------------------------------------
  // Integration: spool → drain cycle
  // -------------------------------------------------------------------------

  test("spool → drain cycle preserves order across multiple rounds", async () => {
    // Round 1: sidecar down — spool events
    await manager.spool(validEvent({ event_id: "evt_cycle_001" }))
    await manager.spool(validEvent({ event_id: "evt_cycle_002" }))

    // Round 2: sidecar still down — spool more events
    await manager.spool(validEvent({ event_id: "evt_cycle_003" }))

    // Round 3: sidecar comes up — drain all
    const receivedIds: string[] = []
    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        const body = (await req.json()) as IngestEventEnvelope
        receivedIds.push(body.event_id)
        return new Response(
          JSON.stringify({ accepted: true, duplicate: false }),
          { headers: { "Content-Type": "application/json" } },
        )
      },
    })

    try {
      const result = await manager.drain(`http://127.0.0.1:${server.port}`)

      expect(result.forwarded).toBe(3)
      expect(result.failed).toBe(0)

      // Verify strict ordering
      expect(receivedIds).toEqual([
        "evt_cycle_001",
        "evt_cycle_002",
        "evt_cycle_003",
      ])
    } finally {
      server.stop(true)
    }
  })

  test("failed drain followed by successful drain retries remaining events", async () => {
    await manager.spool(validEvent({ event_id: "evt_retry_001" }))
    await manager.spool(validEvent({ event_id: "evt_retry_002" }))

    // First drain: sidecar rejects second event
    let callCount = 0
    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        callCount++
        const body = (await req.json()) as IngestEventEnvelope
        if (body.event_id === "evt_retry_002" && callCount <= 2) {
          return new Response(
            JSON.stringify({ accepted: false, error: "busy" }),
            { status: 503, headers: { "Content-Type": "application/json" } },
          )
        }
        return new Response(
          JSON.stringify({ accepted: true, duplicate: false }),
          { headers: { "Content-Type": "application/json" } },
        )
      },
    })

    try {
      // First drain — evt_retry_001 succeeds, evt_retry_002 fails
      const result1 = await manager.drain(`http://127.0.0.1:${server.port}`)
      expect(result1.forwarded).toBe(1)
      expect(result1.failed).toBe(1)

      // Second drain — evt_retry_002 now succeeds
      const result2 = await manager.drain(`http://127.0.0.1:${server.port}`)
      expect(result2.forwarded).toBe(1)
      expect(result2.failed).toBe(0)

      // Spool should be empty
      const hasPending = await manager.hasPending()
      expect(hasPending).toBe(false)
    } finally {
      server.stop(true)
    }
  })

  // -------------------------------------------------------------------------
  // hasPending() tests
  // -------------------------------------------------------------------------

  test("hasPending() returns false when no spool file exists", async () => {
    const result = await manager.hasPending()
    expect(result).toBe(false)
  })

  test("hasPending() returns true after spooling an event", async () => {
    await manager.spool(validEvent())
    const result = await manager.hasPending()
    expect(result).toBe(true)
  })

  test("hasPending() returns false after successful drain", async () => {
    await manager.spool(validEvent())

    const server = Bun.serve({
      port: 0,
      fetch: async () => {
        return new Response(
          JSON.stringify({ accepted: true, duplicate: false }),
          { headers: { "Content-Type": "application/json" } },
        )
      },
    })

    try {
      await manager.drain(`http://127.0.0.1:${server.port}`)
      const result = await manager.hasPending()
      expect(result).toBe(false)
    } finally {
      server.stop(true)
    }
  })
})
