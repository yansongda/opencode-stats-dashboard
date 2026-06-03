/**
 * Integration tests — end-to-end event flow through the plugin pipeline.
 *
 * Scenario 1: Synthetic delete flow
 *   session-created → usage-updated → session-deleted
 *   Verify sidecar receives all 3 events in order and the delete event
 *   carries deleted=true.
 *
 * Scenario 2: Interrupt / resume (spool → drain)
 *   Sidecar is unavailable → events are spooled to JSONL.
 *   Sidecar recovers → drain forwards all buffered events in order.
 *   No events are lost.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "node:path"
import { forwardEvent } from "../src/http/forwarder"
import { SpoolManager } from "../src/spool"
import type { IngestEventEnvelope } from "../src/types"

// ---------------------------------------------------------------------------
// Fixtures — mirrors of fixtures/events/*.json
// ---------------------------------------------------------------------------

const SESSION_CREATED: IngestEventEnvelope = {
  event_id: "evt_intg_aaaa-bbbb-cccc-dddd-0001",
  event_type: "session.created",
  session_id: "ses_intg_001",
  project_path: "/tmp/integration-test",
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

/**
 * usage-updated is emitted mid-session when token/cost counters tick.
 * event_type falls outside the strict EventType union but the sidecar
 * accepts it — the test uses a type assertion to match real-world flow.
 */
const USAGE_UPDATED = {
  event_id: "evt_intg_aaaa-bbbb-cccc-dddd-0002",
  event_type: "usage.updated",
  session_id: "ses_intg_001",
  project_path: "/tmp/integration-test",
  timestamp_ms: 1717400050000,
  model: "claude-sonnet-4-20250514",
  tokens: 1500,
  cost_usd: 0.0075,
  tool: null,
  status: null,
  summary: "mid-session usage snapshot",
  deleted: false,
  metadata: {},
} as unknown as IngestEventEnvelope

const SESSION_DELETED: IngestEventEnvelope = {
  event_id: "evt_intg_aaaa-bbbb-cccc-dddd-0003",
  event_type: "session.deleted",
  session_id: "ses_intg_001",
  project_path: "/tmp/integration-test",
  timestamp_ms: 1717400100000,
  model: "claude-sonnet-4-20250514",
  tokens: 2500,
  cost_usd: 0.0125,
  tool: null,
  status: null,
  summary: "session ended — user deleted",
  deleted: true,
  metadata: { files_changed: 5, additions: 150, deletions: 30 },
}

/** All three events in lifecycle order. */
const LIFECYCLE_EVENTS = [SESSION_CREATED, USAGE_UPDATED, SESSION_DELETED]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ReceivedEvent {
  body: IngestEventEnvelope
  path: string
  timestamp: number
}

/**
 * Create a test sidecar that records every POST to /ingest/event.
 *
 * Returns the server, the accumulated received events, and a toggle
 * to simulate outage / recovery.
 */
function createRecordingSidecar() {
  const received: ReceivedEvent[] = []
  /** When false the server returns 503 — simulates outage. */
  let accepting = true

  const server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url)

      // Health endpoint — always 200
      if (url.pathname === "/health") {
        return new Response("ok", { status: 200 })
      }

      if (!accepting) {
        return new Response(
          JSON.stringify({ accepted: false, error: "unavailable" }),
          { status: 503, headers: { "Content-Type": "application/json" } },
        )
      }

      const body = (await req.json()) as IngestEventEnvelope
      received.push({
        body,
        path: url.pathname,
        timestamp: Date.now(),
      })

      return new Response(
        JSON.stringify({ accepted: true, duplicate: false }),
        { headers: { "Content-Type": "application/json" } },
      )
    },
  })

  return {
    server,
    received,
    get accepting() {
      return accepting
    },
    set accepting(v: boolean) {
      accepting = v
    },
    baseUrl: `http://127.0.0.1:${server.port}`,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Integration: end-to-end event flow", () => {
  // =========================================================================
  // Scenario 1 — Synthetic delete flow
  // =========================================================================

  describe("Scenario 1: synthetic delete lifecycle", () => {
    let sidecar: ReturnType<typeof createRecordingSidecar>

    beforeEach(() => {
      sidecar = createRecordingSidecar()
    })

    afterEach(() => {
      sidecar.server.stop(true)
    })

    test("session-created → usage-updated → session-deleted all reach the sidecar", async () => {
      for (const event of LIFECYCLE_EVENTS) {
        const result = await forwardEvent(event, sidecar.baseUrl)
        expect(result.ok).toBe(true)
      }

      expect(sidecar.received.length).toBe(3)

      // Verify event IDs arrive in lifecycle order
      const ids = sidecar.received.map((r) => r.body.event_id)
      expect(ids).toEqual([
        "evt_intg_aaaa-bbbb-cccc-dddd-0001",
        "evt_intg_aaaa-bbbb-cccc-dddd-0002",
        "evt_intg_aaaa-bbbb-cccc-dddd-0003",
      ])

      // Verify all events target the same session
      for (const r of sidecar.received) {
        expect(r.body.session_id).toBe("ses_intg_001")
      }
    })

    test("session-deleted event carries deleted=true", async () => {
      for (const event of LIFECYCLE_EVENTS) {
        await forwardEvent(event, sidecar.baseUrl)
      }

      const deleteEvent = sidecar.received.find(
        (r) => r.body.event_type === "session.deleted",
      )
      expect(deleteEvent).toBeDefined()
      expect(deleteEvent!.body.deleted).toBe(true)
      expect(deleteEvent!.body.summary).toBe("session ended — user deleted")
      expect(deleteEvent!.body.tokens).toBe(2500)
    })

    test("session-created event has deleted=false", async () => {
      for (const event of LIFECYCLE_EVENTS) {
        await forwardEvent(event, sidecar.baseUrl)
      }

      const createEvent = sidecar.received.find(
        (r) => r.body.event_type === "session.created",
      )
      expect(createEvent).toBeDefined()
      expect(createEvent!.body.deleted).toBe(false)
    })

    test("events arrive at /ingest/event endpoint", async () => {
      for (const event of LIFECYCLE_EVENTS) {
        await forwardEvent(event, sidecar.baseUrl)
      }

      for (const r of sidecar.received) {
        expect(r.path).toBe("/ingest/event")
      }
    })

    test("event metadata survives the round-trip intact", async () => {
      for (const event of LIFECYCLE_EVENTS) {
        await forwardEvent(event, sidecar.baseUrl)
      }

      const deleteEvent = sidecar.received.find(
        (r) => r.body.event_type === "session.deleted",
      )!

      expect(deleteEvent.body.metadata).toEqual({
        files_changed: 5,
        additions: 150,
        deletions: 30,
      })
    })
  })

  // =========================================================================
  // Scenario 2 — Interrupt / resume (spool → drain)
  // =========================================================================

  describe("Scenario 2: interrupt and resume with no event loss", () => {
    let spoolDir: string
    let manager: SpoolManager

    beforeEach(async () => {
      spoolDir = join(
        "/tmp",
        `intg-spool-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      )
      await Bun.write(join(spoolDir, ".gitkeep"), "")
      manager = new SpoolManager({ spoolDir })
    })

    afterEach(async () => {
      try {
        const proc = Bun.spawn(["rm", "-rf", spoolDir])
        await proc.exited
      } catch {
        // Ignore cleanup errors
      }
    })

    test("spool while sidecar is down, drain after recovery — all events forwarded in order", async () => {
      // Phase 1: sidecar is down — spool all three lifecycle events
      for (const event of LIFECYCLE_EVENTS) {
        const result = await manager.spool(event)
        expect(result.ok).toBe(true)
      }

      expect(await manager.hasPending()).toBe(true)

      // Phase 2: sidecar comes up — drain
      const sidecar = createRecordingSidecar()
      try {
        const drainResult = await manager.drain(sidecar.baseUrl)

        expect(drainResult.forwarded).toBe(3)
        expect(drainResult.duplicates).toBe(0)
        expect(drainResult.failed).toBe(0)

        // Verify strict ordering preserved through spool → drain cycle
        const ids = sidecar.received.map((r) => r.body.event_id)
        expect(ids).toEqual([
          "evt_intg_aaaa-bbbb-cccc-dddd-0001",
          "evt_intg_aaaa-bbbb-cccc-dddd-0002",
          "evt_intg_aaaa-bbbb-cccc-dddd-0003",
        ])

        // Spool should be cleared
        expect(await manager.hasPending()).toBe(false)
      } finally {
        sidecar.server.stop(true)
      }
    })

    test("multiple spool rounds during outage — single drain recovers all in order", async () => {
      // Round 1: outage begins — first two events spooled
      await manager.spool(SESSION_CREATED)
      await manager.spool(USAGE_UPDATED)

      // Round 2: still down — third event spooled later
      await manager.spool(SESSION_DELETED)

      // Verify all buffered
      expect(await manager.hasPending()).toBe(true)

      // Recovery: bring sidecar up and drain
      const sidecar = createRecordingSidecar()
      try {
        const result = await manager.drain(sidecar.baseUrl)

        expect(result.forwarded).toBe(3)
        expect(result.failed).toBe(0)

        const ids = sidecar.received.map((r) => r.body.event_id)
        expect(ids).toEqual([
          "evt_intg_aaaa-bbbb-cccc-dddd-0001",
          "evt_intg_aaaa-bbbb-cccc-dddd-0002",
          "evt_intg_aaaa-bbbb-cccc-dddd-0003",
        ])
      } finally {
        sidecar.server.stop(true)
      }
    })

    test("partial drain failure preserves remaining events for next drain", async () => {
      // Spool three events
      await manager.spool(SESSION_CREATED)
      await manager.spool(USAGE_UPDATED)
      await manager.spool(SESSION_DELETED)

      // First drain: sidecar rejects the second event only
      let callIndex = 0
      const sidecar = Bun.serve({
        port: 0,
        fetch: async (req) => {
          callIndex++
          const body = (await req.json()) as IngestEventEnvelope
          // Reject the second call (usage-updated)
          if (callIndex === 2) {
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
        const result1 = await manager.drain(`http://127.0.0.1:${sidecar.port}`)
        expect(result1.forwarded).toBe(2)
        expect(result1.failed).toBe(1)

        // Spool still has the failed event
        expect(await manager.hasPending()).toBe(true)

        // Second drain: sidecar now accepts everything
        callIndex = 999 // Reset so the rejection branch won't trigger
        const result2 = await manager.drain(`http://127.0.0.1:${sidecar.port}`)
        expect(result2.forwarded).toBe(1)
        expect(result2.failed).toBe(0)

        expect(await manager.hasPending()).toBe(false)
      } finally {
        sidecar.stop(true)
      }
    })

    test("interrupt-resume with deleted=true event preserves flag through spool", async () => {
      // Spool only the delete event
      await manager.spool(SESSION_DELETED)

      const sidecar = createRecordingSidecar()
      try {
        await manager.drain(sidecar.baseUrl)

        expect(sidecar.received.length).toBe(1)
        expect(sidecar.received[0].body.deleted).toBe(true)
        expect(sidecar.received[0].body.event_type).toBe("session.deleted")
        expect(sidecar.received[0].body.tokens).toBe(2500)
      } finally {
        sidecar.server.stop(true)
      }
    })

    test("spool → drain cycle handles forwardEvent errors without throwing", async () => {
      await manager.spool(SESSION_CREATED)

      // Drain against a port with nothing listening — forwardEvent never throws
      const result = await manager.drain("http://127.0.0.1:1")

      expect(result.forwarded).toBe(0)
      expect(result.failed).toBe(1)

      // Event is preserved for retry
      expect(await manager.hasPending()).toBe(true)
    })
  })
})
