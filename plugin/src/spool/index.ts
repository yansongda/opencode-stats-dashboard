/**
 * JSONL spool — buffers events when the sidecar is unreachable and
 * drains them in order when it recovers.
 *
 * Design constraints:
 *   - Spool file is a temporary holding area, NOT a permanent data source
 *   - Events are appended as one JSON object per line (JSONL format)
 *   - Drain attempts to forward each event; on full success the file is cleared
 *   - Duplicate events (same event_id) are treated as success during drain
 *   - Privacy: only IngestEventEnvelope (already redacted) is stored
 */

import { join } from "node:path"
import { forwardEvent } from "../http/forwarder"
import type { IngestEventEnvelope } from "../types"

/** Default spool file name inside the spool directory. */
const SPOOL_FILE = "events.jsonl"

export interface SpoolOptions {
  /** Directory where the JSONL spool file is written. */
  spoolDir: string
}

export interface SpoolResult {
  ok: true
  /** Path to the spool file the event was appended to. */
  path: string
}

export interface DrainResult {
  /** Number of events successfully forwarded. */
  forwarded: number
  /** Number of events that were duplicates (still counted as success). */
  duplicates: number
  /** Number of events that failed to forward (file is NOT cleared). */
  failed: number
}

export class SpoolManager {
  private readonly spoolPath: string

  constructor(options: SpoolOptions) {
    this.spoolPath = join(options.spoolDir, SPOOL_FILE)
  }

  /**
   * Append an event to the JSONL spool file.
   *
   * Call this when the sidecar is unreachable. Each call appends one
   * JSON line to the spool file.
   */
  async spool(event: IngestEventEnvelope): Promise<SpoolResult> {
    const line = JSON.stringify(event) + "\n"

    // Bun.write with append mode: if file exists, append; otherwise create.
    // Bun.write overwrites by default, so we read existing content first
    // if the file exists.
    let existing = ""
    try {
      existing = await Bun.file(this.spoolPath).text()
    } catch {
      // File doesn't exist yet — that's fine.
    }

    await Bun.write(this.spoolPath, existing + line)

    return { ok: true, path: this.spoolPath }
  }

  /**
   * Drain the spool file by forwarding all buffered events to the sidecar.
   *
   * Events are forwarded in order. If all events succeed (or are duplicates),
   * the spool file is cleared. If any event fails, the file is保留 so the
   * next drain attempt can retry.
   */
  async drain(sidecarUrl: string): Promise<DrainResult> {
    let content: string
    try {
      content = await Bun.file(this.spoolPath).text()
    } catch {
      // No spool file — nothing to drain.
      return { forwarded: 0, duplicates: 0, failed: 0 }
    }

    const lines = content
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0)

    if (lines.length === 0) {
      return { forwarded: 0, duplicates: 0, failed: 0 }
    }

    const events: IngestEventEnvelope[] = []
    for (const line of lines) {
      try {
        events.push(JSON.parse(line) as IngestEventEnvelope)
      } catch {
        // Malformed line — skip it. This shouldn't happen if spool() wrote it.
      }
    }

    let forwarded = 0
    let duplicates = 0
    let failed = 0
    const failedEvents: IngestEventEnvelope[] = []

    for (const event of events) {
      const result = await forwardEvent(event, sidecarUrl)

      if (result.ok) {
        if (result.duplicate) {
          duplicates++
        } else {
          forwarded++
        }
      } else {
        failed++
        failedEvents.push(event)
      }
    }

    if (failed === 0) {
      // All events forwarded — clear the spool file.
      await Bun.write(this.spoolPath, "")
    } else {
      // Some events failed —保留 only the failed events for next retry.
      const remaining = failedEvents.map((e) => JSON.stringify(e)).join("\n") + "\n"
      await Bun.write(this.spoolPath, remaining)
    }

    return { forwarded, duplicates, failed }
  }

  /**
   * Check if the spool file exists and has content.
   */
  async hasPending(): Promise<boolean> {
    try {
      const content = await Bun.file(this.spoolPath).text()
      return content.trim().length > 0
    } catch {
      return false
    }
  }
}
