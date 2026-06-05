/**
 * Event Store tests — TDD RED phase.
 *
 * Tests cover:
 *   - insertEvent() with idempotent writes (INSERT OR IGNORE)
 *   - getEvents() by session_id, event_type, time range
 *   - getEventById() single event retrieval
 *   - countEvents() with filters
 *   - Batch write performance (1000 events < 500ms)
 */

import { describe, it, expect, beforeEach } from "bun:test"
import { Database } from "bun:sqlite"
import { runMigrations, configurePragmas } from "../db/schema"
import { EventStore } from "./event"
import type { IngestEventEnvelope } from "../types/events"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a fresh in-memory database with migrations applied */
function createTestDb(): Database {
  const db = new Database(":memory:")
  configurePragmas(db)
  runMigrations(db)
  return db
}

/** Build a minimal test event with sensible defaults */
function makeEvent(overrides: Partial<IngestEventEnvelope> = {}): IngestEventEnvelope {
  return {
    event_id: "evt_001",
    event_type: "session.created",
    session_id: "ses_abc123",
    project_path: "/Users/test/project",
    timestamp_ms: 1717400000000,
    model: "claude-sonnet-4-20250514",
    tokens: 1500,
    cost_usd: 0.015,
    tool: null,
    status: null,
    summary: "Session created",
    deleted: false,
    metadata: {},
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("EventStore", () => {
  let db: Database
  let store: EventStore

  beforeEach(() => {
    db = createTestDb()
    store = new EventStore(db)
  })

  // =========================================================================
  // insertEvent
  // =========================================================================

  describe("insertEvent", () => {
    it("inserts a single event and returns true", () => {
      const event = makeEvent()
      const result = store.insertEvent(event)
      expect(result).toBe(true)
    })

    it("is idempotent — duplicate event_id returns false and does not duplicate", () => {
      const event = makeEvent()
      const first = store.insertEvent(event)
      const second = store.insertEvent(event)

      expect(first).toBe(true)
      expect(second).toBe(false)

      const count = store.countEvents()
      expect(count).toBe(1)
    })

    it("maps IngestEventEnvelope fields to correct columns", () => {
      const event = makeEvent({
        event_id: "evt_map",
        event_type: "tool.completed",
        session_id: "ses_xyz",
        model: "gpt-4o",
        tokens: 2000,
        cost_usd: 0.02,
      })
      store.insertEvent(event)

      const row = store.getEventById("evt_map")
      expect(row).not.toBeNull()
      expect(row!.event_id).toBe("evt_map")
      expect(row!.event_type).toBe("tool.completed")
      expect(row!.session_id).toBe("ses_xyz")
      expect(row!.model).toBe("gpt-4o")
      expect(row!.total_tokens).toBe(2000)
      expect(row!.cost_usd).toBe(0.02)
    })

    it("stores extra envelope fields in event_contents JSON", () => {
      const event = makeEvent({
        event_id: "evt_json",
        project_path: "/my/project",
        tool: "read_file",
        status: "completed",
        summary: "Read config",
        deleted: false,
        metadata: { key: "value" },
      })
      store.insertEvent(event)

      const row = store.getEventById("evt_json")
      expect(row).not.toBeNull()

      const contents = JSON.parse(row!.event_contents)
      expect(contents.project_path).toBe("/my/project")
      expect(contents.tool).toBe("read_file")
      expect(contents.status).toBe("completed")
      expect(contents.summary).toBe("Read config")
      expect(contents.deleted).toBe(false)
      expect(contents.metadata.key).toBe("value")
    })
  })

  // =========================================================================
  // getEvents
  // =========================================================================

  describe("getEvents", () => {
    it("returns all events when no filters are applied", () => {
      store.insertEvent(makeEvent({ event_id: "evt_a", session_id: "ses_1" }))
      store.insertEvent(makeEvent({ event_id: "evt_b", session_id: "ses_2" }))
      store.insertEvent(makeEvent({ event_id: "evt_c", session_id: "ses_1" }))

      const results = store.getEvents()
      expect(results.length).toBe(3)
    })

    it("filters by session_id", () => {
      store.insertEvent(makeEvent({ event_id: "evt_1", session_id: "ses_target" }))
      store.insertEvent(makeEvent({ event_id: "evt_2", session_id: "ses_other" }))
      store.insertEvent(makeEvent({ event_id: "evt_3", session_id: "ses_target" }))

      const results = store.getEvents({ session_id: "ses_target" })
      expect(results.length).toBe(2)
      for (const row of results) {
        expect(row.session_id).toBe("ses_target")
      }
    })

    it("filters by event_type", () => {
      store.insertEvent(makeEvent({ event_id: "evt_1", event_type: "session.created" }))
      store.insertEvent(makeEvent({ event_id: "evt_2", event_type: "message.updated" }))
      store.insertEvent(makeEvent({ event_id: "evt_3", event_type: "session.created" }))

      const results = store.getEvents({ event_type: "session.created" })
      expect(results.length).toBe(2)
      for (const row of results) {
        expect(row.event_type).toBe("session.created")
      }
    })

    it("filters by time range (start only)", () => {
      store.insertEvent(makeEvent({ event_id: "evt_old", timestamp_ms: 1000 }))
      store.insertEvent(makeEvent({ event_id: "evt_mid", timestamp_ms: 2000 }))
      store.insertEvent(makeEvent({ event_id: "evt_new", timestamp_ms: 3000 }))

      const results = store.getEvents({ start_ms: 2000 })
      expect(results.length).toBe(2)
      const ids = results.map((r) => r.event_id)
      expect(ids).toContain("evt_mid")
      expect(ids).toContain("evt_new")
    })

    it("filters by time range (end only)", () => {
      store.insertEvent(makeEvent({ event_id: "evt_old", timestamp_ms: 1000 }))
      store.insertEvent(makeEvent({ event_id: "evt_mid", timestamp_ms: 2000 }))
      store.insertEvent(makeEvent({ event_id: "evt_new", timestamp_ms: 3000 }))

      const results = store.getEvents({ end_ms: 2000 })
      expect(results.length).toBe(2)
      const ids = results.map((r) => r.event_id)
      expect(ids).toContain("evt_old")
      expect(ids).toContain("evt_mid")
    })

    it("filters by time range (start + end)", () => {
      store.insertEvent(makeEvent({ event_id: "evt_1", timestamp_ms: 1000 }))
      store.insertEvent(makeEvent({ event_id: "evt_2", timestamp_ms: 2000 }))
      store.insertEvent(makeEvent({ event_id: "evt_3", timestamp_ms: 3000 }))
      store.insertEvent(makeEvent({ event_id: "evt_4", timestamp_ms: 4000 }))

      const results = store.getEvents({ start_ms: 2000, end_ms: 3000 })
      expect(results.length).toBe(2)
      const ids = results.map((r) => r.event_id)
      expect(ids).toContain("evt_2")
      expect(ids).toContain("evt_3")
    })

    it("combines multiple filters", () => {
      store.insertEvent(
        makeEvent({ event_id: "evt_1", session_id: "ses_a", event_type: "session.created", timestamp_ms: 1000 })
      )
      store.insertEvent(
        makeEvent({ event_id: "evt_2", session_id: "ses_a", event_type: "message.updated", timestamp_ms: 2000 })
      )
      store.insertEvent(
        makeEvent({ event_id: "evt_3", session_id: "ses_b", event_type: "session.created", timestamp_ms: 3000 })
      )

      const results = store.getEvents({
        session_id: "ses_a",
        event_type: "session.created",
      })
      expect(results.length).toBe(1)
      expect(results[0]!.event_id).toBe("evt_1")
    })

    it("returns events ordered by timestamp_ms ASC", () => {
      store.insertEvent(makeEvent({ event_id: "evt_c", timestamp_ms: 3000 }))
      store.insertEvent(makeEvent({ event_id: "evt_a", timestamp_ms: 1000 }))
      store.insertEvent(makeEvent({ event_id: "evt_b", timestamp_ms: 2000 }))

      const results = store.getEvents()
      expect(results[0]!.event_id).toBe("evt_a")
      expect(results[1]!.event_id).toBe("evt_b")
      expect(results[2]!.event_id).toBe("evt_c")
    })

    it("supports limit and offset", () => {
      for (let i = 0; i < 10; i++) {
        store.insertEvent(makeEvent({ event_id: `evt_${i}`, timestamp_ms: 1000 + i }))
      }

      const page1 = store.getEvents({ limit: 3, offset: 0 })
      expect(page1.length).toBe(3)
      expect(page1[0]!.event_id).toBe("evt_0")

      const page2 = store.getEvents({ limit: 3, offset: 3 })
      expect(page2.length).toBe(3)
      expect(page2[0]!.event_id).toBe("evt_3")
    })
  })

  // =========================================================================
  // getEventById
  // =========================================================================

  describe("getEventById", () => {
    it("returns the event row when found", () => {
      store.insertEvent(makeEvent({ event_id: "evt_find" }))
      const row = store.getEventById("evt_find")
      expect(row).not.toBeNull()
      expect(row!.event_id).toBe("evt_find")
    })

    it("returns null when not found", () => {
      const row = store.getEventById("evt_missing")
      expect(row).toBeNull()
    })
  })

  // =========================================================================
  // countEvents
  // =========================================================================

  describe("countEvents", () => {
    it("returns 0 for empty table", () => {
      expect(store.countEvents()).toBe(0)
    })

    it("counts all events with no filters", () => {
      store.insertEvent(makeEvent({ event_id: "evt_1" }))
      store.insertEvent(makeEvent({ event_id: "evt_2" }))
      store.insertEvent(makeEvent({ event_id: "evt_3" }))

      expect(store.countEvents()).toBe(3)
    })

    it("counts with session_id filter", () => {
      store.insertEvent(makeEvent({ event_id: "evt_1", session_id: "ses_a" }))
      store.insertEvent(makeEvent({ event_id: "evt_2", session_id: "ses_b" }))
      store.insertEvent(makeEvent({ event_id: "evt_3", session_id: "ses_a" }))

      expect(store.countEvents({ session_id: "ses_a" })).toBe(2)
    })

    it("counts with event_type filter", () => {
      store.insertEvent(makeEvent({ event_id: "evt_1", event_type: "session.created" }))
      store.insertEvent(makeEvent({ event_id: "evt_2", event_type: "message.updated" }))

      expect(store.countEvents({ event_type: "session.created" })).toBe(1)
    })

    it("counts with time range filter", () => {
      store.insertEvent(makeEvent({ event_id: "evt_1", timestamp_ms: 1000 }))
      store.insertEvent(makeEvent({ event_id: "evt_2", timestamp_ms: 2000 }))
      store.insertEvent(makeEvent({ event_id: "evt_3", timestamp_ms: 3000 }))

      expect(store.countEvents({ start_ms: 1500, end_ms: 2500 })).toBe(1)
    })
  })

  // =========================================================================
  // Batch writes
  // =========================================================================

  describe("insertEvents (batch)", () => {
    it("inserts multiple events in a single transaction", () => {
      const events = Array.from({ length: 5 }, (_, i) =>
        makeEvent({ event_id: `batch_${i}`, timestamp_ms: 1000 + i })
      )

      const inserted = store.insertEvents(events)
      expect(inserted).toBe(5)
      expect(store.countEvents()).toBe(5)
    })

    it("skips duplicates in batch and returns count of actually inserted", () => {
      store.insertEvent(makeEvent({ event_id: "dup_1" }))

      const events = [
        makeEvent({ event_id: "dup_1" }), // duplicate
        makeEvent({ event_id: "dup_2" }),
        makeEvent({ event_id: "dup_3" }),
      ]

      const inserted = store.insertEvents(events)
      expect(inserted).toBe(2) // only 2 new events
      expect(store.countEvents()).toBe(3) // total 3
    })

    it("handles empty batch gracefully", () => {
      const inserted = store.insertEvents([])
      expect(inserted).toBe(0)
    })
  })

  // =========================================================================
  // Performance
  // =========================================================================

  describe("performance", () => {
    it("batch inserts 1000 events in under 500ms", () => {
      const events = Array.from({ length: 1000 }, (_, i) =>
        makeEvent({
          event_id: `perf_${i}`,
          session_id: `ses_${i % 10}`,
          event_type: i % 2 === 0 ? "session.created" : "message.updated",
          timestamp_ms: 1717400000000 + i,
          model: i % 3 === 0 ? "claude-sonnet" : "gpt-4o",
          tokens: 100 + i,
          cost_usd: 0.001 * i,
        })
      )

      const start = performance.now()
      store.insertEvents(events)
      const elapsed = performance.now() - start

      expect(elapsed).toBeLessThan(500)
      expect(store.countEvents()).toBe(1000)
    })
  })
})
