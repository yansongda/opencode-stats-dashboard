import { resolve } from "path"

const DEFAULT_TIMEOUT_MS = 10_000
const HEALTH_POLL_INTERVAL_MS = 100

export interface SidecarManagerOptions {
  /** Path to the sidecar binary */
  binaryPath?: string
  /** Timeout for startup and health checks */
  timeoutMs?: number
}

/**
 * Manages the lifecycle of a sidecar process.
 *
 * Spawns the sidecar binary, parses the dynamically assigned port from stdout,
 * and provides health check and shutdown capabilities.
 */
export class SidecarManager {
  private proc: Bun.Subprocess | null = null
  private url: string | null = null
  private readonly binaryPath: string
  private readonly timeoutMs: number

  constructor(options?: SidecarManagerOptions) {
    this.binaryPath =
      options?.binaryPath ??
      resolve(__dirname, "../../../sidecar/target/debug/sidecar-api")
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  /**
   * Spawn the sidecar process, parse its dynamic port, and wait for health check.
   * @returns The base URL of the running sidecar (e.g. "http://127.0.0.1:PORT")
   */
  async start(): Promise<string> {
    if (this.proc) {
      throw new Error("SidecarManager is already running")
    }

    this.proc = Bun.spawn([this.binaryPath], {
      stdout: "pipe",
      stderr: "inherit",
    })

    try {
      this.url = await this.waitForListeningUrl()
      await this.waitForHealthy()
      return this.url
    } catch (err) {
      // Cleanup on failure
      this.proc.kill("SIGTERM")
      await this.proc.exited
      this.proc = null
      this.url = null
      throw err
    }
  }

  /**
   * Gracefully stop the sidecar process.
   * Sends SIGTERM, waits for timeout, then escalates to SIGKILL if needed.
   */
  async stop(): Promise<void> {
    if (!this.proc) return

    // Send SIGTERM for graceful shutdown
    this.proc.kill("SIGTERM")

    // Wait for exit with timeout (5 seconds)
    const timeout = 5000
    const deadline = Date.now() + timeout

    while (Date.now() < deadline) {
      if (this.proc.exitCode !== null) {
        break
      }
      await Bun.sleep(100)
    }

    // If still running, escalate to SIGKILL
    if (this.proc.exitCode === null) {
      this.proc.kill("SIGKILL")
      await this.proc.exited
    }

    this.proc = null
    this.url = null
  }

  /**
   * Get the base URL of the running sidecar.
   * @throws if the sidecar is not running
   */
  getUrl(): string {
    if (!this.url) {
      throw new Error("Sidecar is not running")
    }
    return this.url
  }

  /**
   * Check if the sidecar's /health endpoint returns ok.
   * @returns true if healthy, false otherwise
   */
  async isHealthy(): Promise<boolean> {
    if (!this.url) return false

    try {
      const res = await fetch(`${this.url}/health`)
      if (!res.ok) return false
      const body = (await res.json()) as { status?: string }
      return body.status === "ok"
    } catch {
      return false
    }
  }

  /**
   * Parse the listening URL from sidecar stdout.
   * Expected format: "Listening on Ok(127.0.0.1:PORT)"
   */
  private async waitForListeningUrl(): Promise<string> {
    const deadline = Date.now() + this.timeoutMs
    const reader = this.proc!.stdout!.getReader()
    const decoder = new TextDecoder()
    let buffer = ""

    while (Date.now() < deadline) {
      const { value, done } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      const match = buffer.match(
        /Listening on Ok\((\d+\.\d+\.\d+\.\d+:\d+)\)/,
      )
      if (match) {
        const addr = match[1]
        reader.releaseLock()
        return `http://${addr}`
      }
    }

    reader.releaseLock()
    throw new Error(
      `Timeout: failed to parse listening address within ${this.timeoutMs}ms`,
    )
  }

  /**
   * Poll the /health endpoint until it responds or timeout is reached.
   */
  private async waitForHealthy(): Promise<void> {
    const deadline = Date.now() + this.timeoutMs

    while (Date.now() < deadline) {
      if (await this.isHealthy()) return
      await Bun.sleep(HEALTH_POLL_INTERVAL_MS)
    }

    throw new Error(
      `Timeout: sidecar did not become healthy within ${this.timeoutMs}ms`,
    )
  }
}
