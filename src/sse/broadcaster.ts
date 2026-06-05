/**
 * SSE (Server-Sent Events) broadcaster for real-time stats updates.
 *
 * Provides explicit addClient/removeClient API for managing connections,
 * automatic keepalive, connection timeout handling, and error logging.
 *
 * SSE frame format:
 *   event: stats-update
 *   id: {event_id}
 *   data: {JSON}\n\n
 */

export interface SSEBroadcasterOptions {
  /** Keepalive interval in milliseconds (default: 15000) */
  keepaliveMs?: number;

  /** Idle connection timeout in milliseconds (default: 60000). 0 to disable. */
  connectionTimeoutMs?: number;

  /** Called when a client error occurs (timeout, dead controller, etc.) */
  onError?: (error: Error, clientId: number) => void;
}

interface ClientEntry {
  id: number;
  stream: ReadableStream<Uint8Array>;
  controller: ReadableStreamDefaultController<Uint8Array>;
  keepaliveTimer: ReturnType<typeof setInterval> | null;
  connectionTimer: ReturnType<typeof setTimeout> | null;
}

export class SSEBroadcaster {
  private clients = new Map<number, ClientEntry>();
  private nextId = 1;
  private keepaliveMs: number;
  private connectionTimeoutMs: number;
  private onError: ((error: Error, clientId: number) => void) | null;

  constructor(options?: SSEBroadcasterOptions) {
    this.keepaliveMs = options?.keepaliveMs ?? 15_000;
    this.connectionTimeoutMs = options?.connectionTimeoutMs ?? 60_000;
    this.onError = options?.onError ?? null;
  }

  addClient(): ReadableStream<Uint8Array> {
    const broadcaster = this;
    const id = this.nextId++;
    let controller!: ReadableStreamDefaultController<Uint8Array>;

    const stream = new ReadableStream<Uint8Array>({
      start(ctrl) {
        controller = ctrl;
      },
      cancel() {
        const entry = broadcaster.clients.get(id);
        if (entry?.keepaliveTimer) {
          clearInterval(entry.keepaliveTimer);
          entry.keepaliveTimer = null;
        }
        if (entry?.connectionTimer) {
          clearTimeout(entry.connectionTimer);
          entry.connectionTimer = null;
        }
      },
    });

    const keepalive = new TextEncoder().encode(": keepalive\n\n");
    const keepaliveTimer = setInterval(() => {
      try {
        controller.enqueue(keepalive);
        broadcaster.resetConnectionTimer(id);
      } catch {
        broadcaster.onError?.(
          new Error("keepalive: failed to enqueue — dead controller"),
          id,
        );
        broadcaster.cleanupClient(id);
      }
    }, broadcaster.keepaliveMs);

    const connectionTimer = broadcaster.startConnectionTimer(id);

    broadcaster.clients.set(id, {
      id,
      stream,
      controller,
      keepaliveTimer,
      connectionTimer,
    });

    return stream;
  }

  removeClient(client: ReadableStream<Uint8Array>): void {
    for (const [id, entry] of this.clients) {
      if (entry.stream === client) {
        this.cleanupClient(id);
        try {
          entry.controller.close();
        } catch {
          // Already closed
        }
        return;
      }
    }
  }

  broadcast(data: Record<string, unknown>): void {
    const frame = encodeSSEFrame(data);
    const dead: number[] = [];

    for (const [id, entry] of this.clients) {
      try {
        entry.controller.enqueue(frame);
        this.resetConnectionTimer(id);
      } catch {
        this.onError?.(
          new Error("broadcast: failed to enqueue — dead controller"),
          id,
        );
        dead.push(id);
      }
    }

    for (const id of dead) {
      this.cleanupClient(id);
    }
  }

  get subscriberCount(): number {
    return this.clients.size;
  }

  private startConnectionTimer(
    id: number,
  ): ReturnType<typeof setTimeout> | null {
    if (this.connectionTimeoutMs <= 0) return null;

    return setTimeout(() => {
      this.onError?.(new Error("connection timeout: client idle too long"), id);
      this.cleanupClient(id);
    }, this.connectionTimeoutMs);
  }

  private resetConnectionTimer(id: number): void {
    const entry = this.clients.get(id);
    if (!entry || this.connectionTimeoutMs <= 0) return;

    if (entry.connectionTimer) {
      clearTimeout(entry.connectionTimer);
    }
    entry.connectionTimer = this.startConnectionTimer(id);
  }

  private cleanupClient(id: number): void {
    const entry = this.clients.get(id);
    if (!entry) return;

    if (entry.keepaliveTimer) {
      clearInterval(entry.keepaliveTimer);
    }
    if (entry.connectionTimer) {
      clearTimeout(entry.connectionTimer);
    }
    this.clients.delete(id);
  }
}

function encodeSSEFrame(data: Record<string, unknown>): Uint8Array {
  const eventId = (data.event_id as string) ?? "unknown";
  const json = JSON.stringify(data);
  const frame = `event: stats-update\nid: ${eventId}\ndata: ${json}\n\n`;
  return new TextEncoder().encode(frame);
}
