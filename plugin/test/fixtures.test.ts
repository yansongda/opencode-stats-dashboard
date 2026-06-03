import { test, expect, describe } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import type { IngestEventEnvelope } from "../src/types"
import { FORBIDDEN_METADATA_KEYS } from "../src/types"

const FIXTURES_DIR = resolve(import.meta.dir, "../../fixtures/events")

function loadFixture(name: string): IngestEventEnvelope {
  const raw = readFileSync(resolve(FIXTURES_DIR, `${name}.json`), "utf-8")
  return JSON.parse(raw) as IngestEventEnvelope
}

const REQUIRED_FIELDS: (keyof IngestEventEnvelope)[] = [
  "event_id",
  "event_type",
  "session_id",
  "project_path",
  "timestamp_ms",
  "model",
  "tokens",
  "cost_usd",
  "deleted",
  "metadata",
]

const FIXTURE_NAMES = [
  "session-created",
  "session-deleted",
  "tool-call-started",
  "tool-call-completed",
  "duplicate-event",
  "privacy-redaction",
]

describe("shared event envelope fixtures", () => {
  for (const name of FIXTURE_NAMES) {
    test(`${name}.json has all required envelope fields`, () => {
      const event = loadFixture(name)
      for (const field of REQUIRED_FIELDS) {
        expect(event).toHaveProperty(field)
      }
    })
  }

  test("session-created fixture has correct event_type", () => {
    const event = loadFixture("session-created")
    expect(event.event_type).toBe("session.created")
    expect(event.deleted).toBe(false)
    expect(event.tokens).toBe(0)
    expect(event.cost_usd).toBe(0.0)
  })

  test("session-deleted fixture has deleted=true", () => {
    const event = loadFixture("session-deleted")
    expect(event.event_type).toBe("session.deleted")
    expect(event.deleted).toBe(true)
    expect(event.tokens).toBeGreaterThan(0)
    expect(event.cost_usd).toBeGreaterThan(0)
  })

  test("tool-call-started fixture has tool and status fields", () => {
    const event = loadFixture("tool-call-started")
    expect(event.event_type).toBe("tool.started")
    expect(event.tool).toBe("bash")
    expect(event.status).toBe("started")
    expect(event.deleted).toBe(false)
  })

  test("tool-call-completed fixture has completed status", () => {
    const event = loadFixture("tool-call-completed")
    expect(event.event_type).toBe("tool.completed")
    expect(event.tool).toBe("bash")
    expect(event.status).toBe("completed")
    expect(event.metadata).toHaveProperty("exit_code")
    expect(event.metadata).toHaveProperty("duration_ms")
  })

  test("duplicate-event shares event_id with session-created for idempotency testing", () => {
    const original = loadFixture("session-created")
    const duplicate = loadFixture("duplicate-event")
    expect(duplicate.event_id).toBe(original.event_id)
    expect(duplicate.session_id).toBe(original.session_id)
  })

  test("privacy-redaction fixture has no full payload fields in metadata", () => {
    const event = loadFixture("privacy-redaction")
    for (const key of FORBIDDEN_METADATA_KEYS) {
      expect(event.metadata).not.toHaveProperty(key)
    }
  })

  test("all fixtures have valid event_type values", () => {
    const validTypes = ["session.created", "session.deleted", "tool.started", "tool.completed"]
    for (const name of FIXTURE_NAMES) {
      const event = loadFixture(name)
      expect(validTypes).toContain(event.event_type)
    }
  })

  test("all fixtures have positive timestamp_ms", () => {
    for (const name of FIXTURE_NAMES) {
      const event = loadFixture(name)
      expect(event.timestamp_ms).toBeGreaterThan(0)
    }
  })

  test("all fixtures have non-empty session_id and project_path", () => {
    for (const name of FIXTURE_NAMES) {
      const event = loadFixture(name)
      expect(event.session_id.length).toBeGreaterThan(0)
      expect(event.project_path.length).toBeGreaterThan(0)
    }
  })
})
