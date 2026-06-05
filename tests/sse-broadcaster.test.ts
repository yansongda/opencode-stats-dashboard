import { describe, test, expect } from "bun:test"
import { SSEBroadcaster } from "../src/sse/broadcaster"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Helper: read one SSE frame from a ReadableStreamDefaultReader */
async function readFrame(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs = 2000
): Promise<string> {
  const result = await Promise.race([
    (async () => {
      const { value, done } = await reader.read()
      if (done) return ""
      return new TextDecoder().decode(value)
    })(),
    new Promise<string>((_, reject) =>
      setTimeout(() => reject(new Error("readFrame timeout")), timeoutMs)
    ),
  ])
  return result
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SSEBroadcaster", () => {
  // -----------------------------------------------------------------------
  // Connection management
  // -----------------------------------------------------------------------

  describe("addClient / removeClient", () => {
    test("addClient returns a ReadableStream", () => {
      const broadcaster = new SSEBroadcaster()
      const stream = broadcaster.addClient()
      expect(stream).toBeInstanceOf(ReadableStream)
      stream.cancel()
    })

    test("subscriberCount tracks connected clients via removeClient", () => {
      const broadcaster = new SSEBroadcaster()
      expect(broadcaster.subscriberCount).toBe(0)

      const s1 = broadcaster.addClient()
      expect(broadcaster.subscriberCount).toBe(1)

      const s2 = broadcaster.addClient()
      expect(broadcaster.subscriberCount).toBe(2)

      broadcaster.removeClient(s1)
      expect(broadcaster.subscriberCount).toBe(1)

      broadcaster.removeClient(s2)
      expect(broadcaster.subscriberCount).toBe(0)
    })

    test("removeClient removes a specific client by stream reference", () => {
      const broadcaster = new SSEBroadcaster()
      const s1 = broadcaster.addClient()
      const s2 = broadcaster.addClient()
      expect(broadcaster.subscriberCount).toBe(2)

      broadcaster.removeClient(s1)
      expect(broadcaster.subscriberCount).toBe(1)

      broadcaster.removeClient(s2)
      expect(broadcaster.subscriberCount).toBe(0)
    })

    test("removeClient is idempotent for unknown stream", () => {
      const broadcaster = new SSEBroadcaster()
      const s1 = broadcaster.addClient()
      broadcaster.removeClient(s1)
      // Removing again should not throw
      broadcaster.removeClient(s1)
      expect(broadcaster.subscriberCount).toBe(0)
    })
  })

  // -----------------------------------------------------------------------
  // Broadcast functionality
  // -----------------------------------------------------------------------

  describe("broadcast", () => {
    test("broadcast sends message to all connected clients", async () => {
      const b = new SSEBroadcaster()
      const stream1 = b.addClient()
      const reader1 = stream1.getReader()
      const stream2 = b.addClient()
      const reader2 = stream2.getReader()

      b.broadcast({
        event_id: "evt_001",
        type: "message",
        action: "updated",
        timestamp: "2026-06-04T10:00:00Z",
      })

      const frame1 = await readFrame(reader1)
      const frame2 = await readFrame(reader2)

      expect(frame1).toContain("event: stats-update")
      expect(frame1).toContain("id: evt_001")
      expect(frame1).toContain('"event_id":"evt_001"')

      expect(frame2).toContain("event: stats-update")
      expect(frame2).toContain("id: evt_001")
    })

    test("broadcast sends same message to all clients", async () => {
      const b = new SSEBroadcaster()
      const streams = Array.from({ length: 3 }, () => b.addClient())
      const readers = streams.map((s) => s.getReader())

      b.broadcast({
        event_id: "evt_multi",
        type: "session",
        action: "created",
        timestamp: "2026-06-04T10:00:00Z",
      })

      for (const reader of readers) {
        const frame = await readFrame(reader)
        expect(frame).toContain("id: evt_multi")
        expect(frame).toContain('"event_id":"evt_multi"')
      }
    })

    test("broadcast with no clients does not throw", () => {
      const b = new SSEBroadcaster()
      // Should not throw
      b.broadcast({
        event_id: "evt_noone",
        type: "tool",
        action: "created",
        timestamp: "2026-06-04T10:00:00Z",
      })
    })

    test("broadcast only reaches active clients (not removed ones)", async () => {
      const b = new SSEBroadcaster()

      const stream1 = b.addClient()
      const reader1 = stream1.getReader()

      const stream2 = b.addClient() // will be removed
      const stream3 = b.addClient()
      const reader3 = stream3.getReader()

      // Remove client 2 before broadcast
      b.removeClient(stream2)

      b.broadcast({
        event_id: "evt_filtered",
        type: "message",
        action: "updated",
        timestamp: "2026-06-04T10:00:00Z",
      })

      // Client 1 should receive
      const frame1 = await readFrame(reader1)
      expect(frame1).toContain("id: evt_filtered")

      // Client 3 should receive
      const frame3 = await readFrame(reader3)
      expect(frame3).toContain("id: evt_filtered")

      // Verify subscriber count
      expect(b.subscriberCount).toBe(2)
    })

    test("broadcast cleans up dead controllers automatically", async () => {
      const b = new SSEBroadcaster()

      const stream1 = b.addClient()
      const reader1 = stream1.getReader()
      const stream2 = b.addClient()

      // Cancel stream2 — clears timers but client stays in map
      stream2.cancel()

      await new Promise((r) => setTimeout(r, 10))

      // Client still in map until broadcast detects dead controller
      expect(b.subscriberCount).toBe(2)

      // Broadcast detects dead controller and cleans up
      b.broadcast({
        event_id: "evt_after_dead",
        type: "message",
        action: "updated",
        timestamp: "2026-06-04T10:00:00Z",
      })

      expect(b.subscriberCount).toBe(1)

      const frame = await readFrame(reader1)
      expect(frame).toContain("id: evt_after_dead")
    })
  })

  // -----------------------------------------------------------------------
  // SSE frame format
  // -----------------------------------------------------------------------

  describe("SSE frame format", () => {
    test("frame contains correct SSE structure", async () => {
      const b = new SSEBroadcaster()
      const stream = b.addClient()
      const reader = stream.getReader()

      b.broadcast({
        event_id: "evt_format_test",
        type: "error",
        action: "created",
        timestamp: "2026-06-04T12:30:00Z",
      })

      const frame = await readFrame(reader)

      // Must have event: line
      expect(frame).toContain("event: stats-update\n")
      // Must have id: line
      expect(frame).toContain("id: evt_format_test\n")
      // Must have data: line with JSON
      expect(frame).toMatch(/data: \{.*\}\n\n/)
      // JSON should be valid
      const dataMatch = frame.match(/data: ({.*})\n\n/)
      expect(dataMatch).not.toBeNull()
      const parsed = JSON.parse(dataMatch![1])
      expect(parsed.event_id).toBe("evt_format_test")
      expect(parsed.type).toBe("error")
      expect(parsed.action).toBe("created")
      expect(parsed.timestamp).toBe("2026-06-04T12:30:00Z")
    })
  })

  // -----------------------------------------------------------------------
  // Keepalive mechanism
  // -----------------------------------------------------------------------

  describe("keepalive", () => {
    test("keepalive sends comment frame at configured interval", async () => {
      const b = new SSEBroadcaster({ keepaliveMs: 100 })
      const stream = b.addClient()
      const reader = stream.getReader()

      // Advance time past the keepalive interval
      await new Promise((r) => setTimeout(r, 150))

      const frame = await readFrame(reader, 500)
      expect(frame).toContain(": keepalive")
      expect(frame).toContain("\n\n")

      // Clean up - release reader lock first, then cancel
      reader.releaseLock()
      stream.cancel()
    })

    test("keepalive stops after client is removed", async () => {
      const b = new SSEBroadcaster({ keepaliveMs: 100 })
      const s1 = b.addClient()
      const s2 = b.addClient()
      const reader2 = s2.getReader()

      // Remove first client
      b.removeClient(s1)

      // The second client should still receive keepalive
      await new Promise((r) => setTimeout(r, 150))
      const frame = await readFrame(reader2, 500)
      expect(frame).toContain(": keepalive")

      reader2.releaseLock()
      s2.cancel()
    })

    test("keepalive stops after stream is cancelled", async () => {
      const b = new SSEBroadcaster({ keepaliveMs: 100 })
      const stream = b.addClient()
      const reader = stream.getReader()

      // Release lock and cancel
      reader.releaseLock()
      stream.cancel()

      // Stream should be closed
      const reader2 = stream.getReader()
      const { done } = await reader2.read()
      expect(done).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  describe("edge cases", () => {
    test("broadcast with large payload", async () => {
      const b = new SSEBroadcaster()
      const stream = b.addClient()
      const reader = stream.getReader()

      const largeData = {
        event_id: "evt_large",
        type: "message" as const,
        action: "updated" as const,
        timestamp: "2026-06-04T10:00:00Z",
        payload: "x".repeat(10000),
      }

      b.broadcast(largeData)

      const frame = await readFrame(reader)
      expect(frame).toContain("id: evt_large")
      expect(frame).toContain("x".repeat(100))
    })

    test("broadcast with special characters in data", async () => {
      const b = new SSEBroadcaster()
      const stream = b.addClient()
      const reader = stream.getReader()

      b.broadcast({
        event_id: "evt_special",
        type: "session",
        action: "created",
        timestamp: "2026-06-04T10:00:00Z",
        title: 'Test with "quotes" and\nnewlines',
      })

      const frame = await readFrame(reader)
      expect(frame).toContain("id: evt_special")
      // Should still contain valid JSON in data line
      const dataMatch = frame.match(/data: ({.*})\n\n/)
      expect(dataMatch).not.toBeNull()
      const parsed = JSON.parse(dataMatch![1])
      expect(parsed.title).toContain("quotes")
      expect(parsed.title).toContain("\n")
    })

    test("rapid broadcast does not lose messages", async () => {
      const b = new SSEBroadcaster()
      const stream = b.addClient()
      const reader = stream.getReader()

      // Send 10 messages rapidly
      for (let i = 0; i < 10; i++) {
        b.broadcast({
          event_id: `evt_rapid_${i}`,
          type: "message",
          action: "updated",
          timestamp: "2026-06-04T10:00:00Z",
        })
      }

      // Read all 10 messages
      const messages: string[] = []
      for (let i = 0; i < 10; i++) {
        const frame = await readFrame(reader, 1000)
        messages.push(frame)
      }

      expect(messages.length).toBe(10)
      for (let i = 0; i < 10; i++) {
        expect(messages[i]).toContain(`evt_rapid_${i}`)
      }
    })
  })

  // -----------------------------------------------------------------------
  // Connection timeout handling
  // -----------------------------------------------------------------------

  describe("connection timeout", () => {
    test("auto-removes client after connectionTimeoutMs with no activity", async () => {
      const b = new SSEBroadcaster({
        connectionTimeoutMs: 100,
        keepaliveMs: 10_000, // long keepalive so it doesn't interfere
      })
      const stream = b.addClient()
      expect(b.subscriberCount).toBe(1)

      // Wait for timeout to fire
      await new Promise((r) => setTimeout(r, 200))

      expect(b.subscriberCount).toBe(0)
    })

    test("connection timeout resets on successful broadcast", async () => {
      const b = new SSEBroadcaster({
        connectionTimeoutMs: 150,
        keepaliveMs: 10_000,
      })
      const stream = b.addClient()
      const reader = stream.getReader()

      // Broadcast before timeout
      await new Promise((r) => setTimeout(r, 100))
      b.broadcast({
        event_id: "evt_keepalive",
        type: "message",
        action: "updated",
        timestamp: "2026-06-04T10:00:00Z",
      })

      // Wait another 100ms (total 200ms from start, but only 100ms since last activity)
      await new Promise((r) => setTimeout(r, 100))
      // Client should still be alive since timeout resets on broadcast
      expect(b.subscriberCount).toBe(1)

      // Read the frame to consume it
      await readFrame(reader, 500)

      // Now wait for full timeout from last activity
      await new Promise((r) => setTimeout(r, 200))
      expect(b.subscriberCount).toBe(0)
    })

    test("connection timeout resets on successful keepalive", async () => {
      const b = new SSEBroadcaster({
        connectionTimeoutMs: 200,
        keepaliveMs: 80,
      })
      const stream = b.addClient()
      const reader = stream.getReader()

      // Wait for keepalive to fire and reset timeout
      await new Promise((r) => setTimeout(r, 100))
      expect(b.subscriberCount).toBe(1)

      // Keepalive should have reset the timeout, so wait another 100ms
      await new Promise((r) => setTimeout(r, 100))
      // Still alive because keepalive extended the timeout
      expect(b.subscriberCount).toBe(1)

      reader.releaseLock()
      stream.cancel()
    })

    test("connection timeout fires onError callback", async () => {
      const errors: Array<{ error: Error; clientId: number }> = []
      const b = new SSEBroadcaster({
        connectionTimeoutMs: 100,
        keepaliveMs: 10_000,
        onError: (error, clientId) => {
          errors.push({ error, clientId })
        },
      })
      const stream = b.addClient()

      await new Promise((r) => setTimeout(r, 200))

      expect(errors.length).toBe(1)
      expect(errors[0].error.message).toContain("timeout")
      expect(errors[0].clientId).toBeGreaterThan(0)
    })
  })

  // -----------------------------------------------------------------------
  // Error logging
  // -----------------------------------------------------------------------

  describe("error logging", () => {
    test("onError callback fires when broadcast to dead client fails", () => {
      const errors: Array<{ error: Error; clientId: number }> = []
      const b = new SSEBroadcaster({
        onError: (error, clientId) => {
          errors.push({ error, clientId })
        },
      })
      const stream = b.addClient()

      // Cancel the stream to make the controller dead
      stream.cancel()

      // Broadcast should trigger error for the dead client
      b.broadcast({
        event_id: "evt_err",
        type: "message",
        action: "updated",
        timestamp: "2026-06-04T10:00:00Z",
      })

      expect(errors.length).toBe(1)
      expect(errors[0].error.message).toContain("dead")
    })

    test("onError callback is optional — no crash when omitted", () => {
      const b = new SSEBroadcaster()
      const stream = b.addClient()
      stream.cancel()

      // Should not throw
      b.broadcast({
        event_id: "evt_no_err_cb",
        type: "message",
        action: "updated",
        timestamp: "2026-06-04T10:00:00Z",
      })
    })

    test("onError fires for each dead client independently", () => {
      const errors: Array<{ error: Error; clientId: number }> = []
      const b = new SSEBroadcaster({
        onError: (error, clientId) => {
          errors.push({ error, clientId })
        },
      })

      const s1 = b.addClient()
      const s2 = b.addClient()
      const s3 = b.addClient()
      const reader3 = s3.getReader()

      // Kill s1 and s2
      s1.cancel()
      s2.cancel()

      b.broadcast({
        event_id: "evt_multi_err",
        type: "message",
        action: "updated",
        timestamp: "2026-06-04T10:00:00Z",
      })

      // Two dead clients should have triggered errors
      expect(errors.length).toBe(2)
      // s3 should still receive the message
      expect(b.subscriberCount).toBe(1)

      reader3.releaseLock()
      s3.cancel()
    })
  })
})
