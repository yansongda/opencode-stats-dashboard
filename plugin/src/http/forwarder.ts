/**
 * HTTP forwarder — sends IngestEventEnvelope to the sidecar ingest API.
 *
 * Design constraints:
 *   - NEVER throws: all failures are returned as { ok: false, error }
 *   - Treats duplicate responses (accepted: true, duplicate: true) as success
 *   - Uses a short timeout so OpenCode interaction is never blocked
 */

import type { IngestEventEnvelope } from "../types"

/** Successful forward — event was accepted by the sidecar. */
export interface ForwardSuccess {
  ok: true
  /** true when the sidecar reported this event_id already existed. */
  duplicate: boolean
}

/** Failed forward — network or HTTP error. */
export interface ForwardFailure {
  ok: false
  /** Human-readable error description. */
  error: string
  /** HTTP status code, if a response was received. */
  status?: number
}

export type ForwardResult = ForwardSuccess | ForwardFailure

/** Default request timeout — 5 seconds is generous for localhost. */
const DEFAULT_TIMEOUT_MS = 5_000

/**
 * POST an IngestEventEnvelope to the sidecar `/ingest/event` endpoint.
 *
 * @param event      The envelope to forward.
 * @param sidecarUrl Base URL of the sidecar (e.g. "http://127.0.0.1:9100").
 *                   The path `/ingest/event` is appended automatically.
 * @returns ForwardResult — never throws.
 */
export async function forwardEvent(
  event: IngestEventEnvelope,
  sidecarUrl: string,
): Promise<ForwardResult> {
  const url = `${sidecarUrl.replace(/\/+$/, "")}/ingest/event`

  let res: Response
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(
      () => controller.abort(),
      DEFAULT_TIMEOUT_MS,
    )

    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }

  if (!res.ok) {
    return {
      ok: false,
      error: `HTTP ${res.status}`,
      status: res.status,
    }
  }

  let body: { accepted?: boolean; duplicate?: boolean }
  try {
    body = (await res.json()) as {
      accepted?: boolean
      duplicate?: boolean
    }
  } catch {
    return { ok: false, error: "invalid_json_response" }
  }

  if (!body.accepted) {
    return {
      ok: false,
      error: "sidecar_rejected",
      status: res.status,
    }
  }

  return { ok: true, duplicate: body.duplicate ?? false }
}
