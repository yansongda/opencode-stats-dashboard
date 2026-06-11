import type { Logger } from "@/logger";

/**
 * LeaderManager — single-instance HTTP server ownership with takeover polling
 *
 * First process to bind STATS_PORT becomes leader and serves HTTP/SSE.
 * A second process encountering EADDRINUSE becomes follower without throwing,
 * while DB and event processing remain initialized.
 *
 * Followers retry binding the port every POLL_INTERVAL_MS. When the previous
 * leader releases the port, the first follower to succeed becomes the new leader.
 */

export type ServerRole = "leader" | "follower";

/** Polling interval for followers to retry binding the HTTP port (ms). */
export const POLL_INTERVAL_MS = 5000;

/** Robust EADDRINUSE detection — Bun does not guarantee a single error shape. */
function isAddrInUse(err: unknown): boolean {
  if (err instanceof Error) {
    const e = err as Error & { code?: string };
    if (e.code === "EADDRINUSE") return true;
    if (e.message.toLowerCase().includes("address already in use")) return true;
    if (e.message.includes("EADDRINUSE")) return true;
  }
  return false;
}

export class LeaderManager {
  private server: ReturnType<typeof Bun.serve> | null = null;
  private role: ServerRole = "follower";
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private readonly port: number;
  private readonly fetch: (req: Request) => Response | Promise<Response>;
  private readonly log: Logger;

  constructor(params: {
    port: number;
    fetch: (req: Request) => Response | Promise<Response>;
    log: Logger;
  }) {
    this.port = params.port;
    this.fetch = params.fetch;
    this.log = params.log;
  }

  /**
   * Attempt to bind the HTTP server.
   *
   * - Success → role = "leader", server stored.
   * - EADDRINUSE → role = "follower", starts 5s polling to retry binding.
   * - Other error → rethrow (caller must handle).
   *
   * Repeated calls while leader are no-ops.
   * Repeated calls while follower do not create duplicate intervals.
   */
  start(): void {
    if (this.role === "leader") return;
    if (this.pollTimer) return;

    try {
      this.server = Bun.serve({
        port: this.port,
        fetch: this.fetch,
        idleTimeout: 0,
      });
      this.role = "leader";
      this.log("info", `[stats-engine] role=leader port=${this.server.port}`);
    } catch (err) {
      if (isAddrInUse(err)) {
        this.role = "follower";
        this.server = null;
        this.log(
          "info",
          `[stats-engine] role=follower port=${this.port} (address in use, running without HTTP)`,
        );
        this.startPolling();
        return;
      }
      throw err;
    }
  }

  /** Safe stop — clears polling timer; stops server if leader. */
  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (!this.server) return;
    try {
      this.server.stop();
    } catch (err) {
      this.log("error", "server.stop failed", err);
    }
    this.server = null;
  }

  getRole(): ServerRole {
    return this.role;
  }

  private startPolling(): void {
    this.pollTimer = setInterval(() => {
      try {
        this.server = Bun.serve({
          port: this.port,
          fetch: this.fetch,
          idleTimeout: 0,
        });
        if (this.pollTimer) {
          clearInterval(this.pollTimer);
          this.pollTimer = null;
        }
        this.role = "leader";
        this.log(
          "info",
          `[stats-engine] role=leader (took over from previous leader) port=${this.server.port}`,
        );
      } catch (err) {
        if (isAddrInUse(err)) return;
        this.log("error", "leader takeover poll failed", err);
      }
    }, POLL_INTERVAL_MS);
  }
}
