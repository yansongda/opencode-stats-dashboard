/**
 * SSE (Server-Sent Events) broadcaster for real-time stats updates.
 *
 * Replaces the Rust sidecar's UpdateBroadcaster (tokio::sync::broadcast).
 * Uses Bun built-ins only — no npm packages required.
 *
 * Each SSE message format:
 *   event: stats-update
 *   id: {last_event_id}
 *   data: {JSON}\n\n
 */

/** Shape of a stats update broadcast to all SSE subscribers. */
export interface StatsUpdate {
  last_event_id: string
  updated_at: string
}

/**
 * SSEBroadcaster manages multiple SSE subscribers and broadcasts
 * StatsUpdate messages to all active connections.
 */
export class SSEBroadcaster {
  private subscribers = new Map<
    number,
    ReadableStreamDefaultController<Uint8Array>
  >()
  private nextId = 0

  /**
   * Subscribe to the SSE stream. Returns a ReadableStream that yields
   * encoded SSE frames. The stream closes when the subscriber disconnects.
   */
  subscribe(): ReadableStream<Uint8Array> {
    const id = this.nextId++
    const broadcaster = this
    let controller: ReadableStreamDefaultController<Uint8Array>

    const stream = new ReadableStream<Uint8Array>({
      start(ctrl) {
        controller = ctrl
        broadcaster.subscribers.set(id, controller)
      },
      cancel() {
        broadcaster.subscribers.delete(id)
      },
    })

    return stream
  }

  /**
   * Broadcast a stats update to all active subscribers.
   * Silently drops the message if no subscribers are connected.
   */
  broadcast(data: StatsUpdate): void {
    const frame = encodeSSEFrame(data)
    const dead: number[] = []

    for (const [id, controller] of this.subscribers) {
      try {
        controller.enqueue(frame)
      } catch {
        // Controller is closed/cancelled — mark for cleanup
        dead.push(id)
      }
    }

    // Clean up dead controllers
    for (const id of dead) {
      this.subscribers.delete(id)
    }
  }

  /**
   * Returns the number of active SSE subscribers.
   */
  get subscriberCount(): number {
    return this.subscribers.size
  }
}

/**
 * Encode a StatsUpdate as an SSE frame (UTF-8 bytes):
 *   event: stats-update
 *   id: {last_event_id}
 *   data: {JSON}\n\n
 */
function encodeSSEFrame(update: StatsUpdate): Uint8Array {
  const json = JSON.stringify(update)
  const frame = `event: stats-update\nid: ${update.last_event_id}\ndata: ${json}\n\n`
  return new TextEncoder().encode(frame)
}
