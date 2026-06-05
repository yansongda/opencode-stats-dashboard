/**
 * projection_tool_calls handler — tracks individual tool call lifecycle.
 *
 * Processes:
 *  - tool.started   → INSERT row with status='pending'
 *  - tool.completed  → UPDATE row with status='completed', duration, tokens, cost
 *  - tool.failed     → UPDATE row with status='error', error_message
 *
 * Design doc: §4.3 projection_tool_calls
 */

import type { ProjectionHandler, TransactionContext } from "./handlers/types"
import type { IngestEventEnvelope } from "../types/events"

// ---------------------------------------------------------------------------
// Token Breakdown (from metadata)
// ---------------------------------------------------------------------------

interface TokenBreakdownCache {
  read: number
  write: number
}

interface TokenBreakdown {
  input: number
  output: number
  reasoning: number
  cache: TokenBreakdownCache
}

// ---------------------------------------------------------------------------
// Metadata Extraction Helpers
// ---------------------------------------------------------------------------

function getString(meta: Record<string, unknown>, key: string): string | null {
  const val = meta[key]
  return typeof val === "string" ? val : null
}

function getNumber(meta: Record<string, unknown>, key: string): number {
  const val = meta[key]
  return typeof val === "number" ? val : 0
}

function getTokenBreakdown(meta: Record<string, unknown>): {
  input: number
  output: number
  cache_read: number
  cache_write: number
} {
  const tokens = meta["tokens"] as TokenBreakdown | undefined
  if (!tokens || typeof tokens !== "object") {
    return { input: 0, output: 0, cache_read: 0, cache_write: 0 }
  }
  const cache = tokens.cache ?? { read: 0, write: 0 }
  return {
    input: tokens.input ?? 0,
    output: tokens.output ?? 0,
    cache_read: cache.read ?? 0,
    cache_write: cache.write ?? 0,
  }
}

// ---------------------------------------------------------------------------
// Event Handlers
// ---------------------------------------------------------------------------

function handleToolStarted(event: IngestEventEnvelope, txn: TransactionContext): void {
  const meta = event.metadata
  const callId = getString(meta, "call_id")
  if (!callId) return

  const toolName = getString(meta, "tool_name") ?? event.tool ?? "unknown"
  const title = getString(meta, "title")

  txn.run(
    `INSERT OR IGNORE INTO projection_tool_calls
       (call_id, session_id, tool_name, status, started_at, title)
     VALUES (?, ?, ?, 'pending', ?, ?)`,
    [callId, event.session_id, toolName, event.timestamp_ms, title]
  )
}

function handleToolCompleted(event: IngestEventEnvelope, txn: TransactionContext): void {
  const meta = event.metadata
  const callId = getString(meta, "call_id")
  if (!callId) return

  // Check if the tool call record exists
  const existing = txn.get("SELECT call_id FROM projection_tool_calls WHERE call_id = ?", [callId])
  if (!existing) return

  const title = getString(meta, "title")
  const durationMs = getNumber(meta, "duration_ms")
  const { input, output, cache_read, cache_write } = getTokenBreakdown(meta)

  txn.run(
    `UPDATE projection_tool_calls
     SET status = 'completed',
         completed_at = ?,
         duration_ms = ?,
         input_tokens = ?,
         output_tokens = ?,
         cache_read = ?,
         cache_write = ?,
         cost_usd = ?,
         title = COALESCE(?, title),
         projected_at = CURRENT_TIMESTAMP
     WHERE call_id = ?`,
    [
      event.timestamp_ms,
      durationMs || null,
      input,
      output,
      cache_read,
      cache_write,
      event.cost_usd,
      title,
      callId,
    ]
  )
}

function handleToolFailed(event: IngestEventEnvelope, txn: TransactionContext): void {
  const meta = event.metadata
  const callId = getString(meta, "call_id")
  if (!callId) return

  // Check if the tool call record exists
  const existing = txn.get("SELECT call_id FROM projection_tool_calls WHERE call_id = ?", [callId])
  if (!existing) return

  const errorMessage = getString(meta, "error_message")
  const durationMs = getNumber(meta, "duration_ms")

  txn.run(
    `UPDATE projection_tool_calls
     SET status = 'error',
         completed_at = ?,
         duration_ms = ?,
         error_message = ?,
         projected_at = CURRENT_TIMESTAMP
     WHERE call_id = ?`,
    [event.timestamp_ms, durationMs || null, errorMessage, callId]
  )
}

// ---------------------------------------------------------------------------
// Handler Export
// ---------------------------------------------------------------------------

/**
 * ProjectionHandler for projection_tool_calls table.
 *
 * Handles tool lifecycle events:
 *  - tool.started   → create record (pending)
 *  - tool.completed  → update record (completed + stats)
 *  - tool.failed     → update record (error + message)
 */
export const toolCallHandler: ProjectionHandler = {
  handles: ["tool.started", "tool.completed", "tool.failed"],

  handle(event: IngestEventEnvelope, txn: TransactionContext): void {
    switch (event.event_type) {
      case "tool.started":
        handleToolStarted(event, txn)
        break
      case "tool.completed":
        handleToolCompleted(event, txn)
        break
      case "tool.failed":
        handleToolFailed(event, txn)
        break
    }
  },
}
