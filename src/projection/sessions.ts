/**
 * Session Projection Handler — processes events into projection_sessions rows.
 *
 * Handles:
 *  - session.created:  create session record
 *  - session.deleted:  update status to deleted
 *  - message.updated:  update token/message stats, model_usage
 *  - tool.execute.before / tool.execute.after: update tool stats
 *  - file.edited:      update file stats
 *  - session.error:    increment error_count
 *  - agent.completed:  update agent_usage
 *
 * Design doc: §4.1 — projection_sessions field source mapping.
 *
 * Type safety: uses type guards for JSON field parsing (no `as` assertions).
 */

import type { EventType, IngestEventEnvelope, TokenBreakdown } from "../types/events"
import type { ProjectionHandler, TransactionContext } from "./handlers/types"
import type { ModelUsage, ModelUsageEntry, AgentUsage, AgentUsageEntry } from "../types/projections"

// ---------------------------------------------------------------------------
// Type Guards (JSON field validation)
// ---------------------------------------------------------------------------

function isTokenBreakdown(data: unknown): data is TokenBreakdown {
  if (typeof data !== "object" || data === null) return false
  const obj = data as Record<string, unknown>
  return (
    typeof obj['input'] === "number" &&
    typeof obj['output'] === "number" &&
    typeof obj['reasoning'] === "number" &&
    typeof obj['cache'] === "object" &&
    obj['cache'] !== null &&
    typeof (obj['cache'] as Record<string, unknown>)['read'] === "number" &&
    typeof (obj['cache'] as Record<string, unknown>)['write'] === "number"
  )
}

function isModelUsageEntry(data: unknown): data is ModelUsageEntry {
  if (typeof data !== "object" || data === null) return false
  const obj = data as Record<string, unknown>
  return (
    typeof obj['message_count'] === "number" &&
    isTokenBreakdown(obj['tokens']) &&
    typeof obj['cost_usd'] === "number"
  )
}

function isModelUsage(data: unknown): data is ModelUsage {
  if (typeof data !== "object" || data === null) return false
  const obj = data as Record<string, unknown>
  for (const key of Object.keys(obj)) {
    if (!isModelUsageEntry(obj[key])) return false
  }
  return true
}

function isAgentUsageEntry(data: unknown): data is AgentUsageEntry {
  if (typeof data !== "object" || data === null) return false
  const obj = data as Record<string, unknown>
  return (
    typeof obj['message_count'] === "number" &&
    isTokenBreakdown(obj['tokens']) &&
    typeof obj['cost_usd'] === "number"
  )
}

function isAgentUsage(data: unknown): data is AgentUsage {
  if (typeof data !== "object" || data === null) return false
  const obj = data as Record<string, unknown>
  for (const key of Object.keys(obj)) {
    if (!isAgentUsageEntry(obj[key])) return false
  }
  return true
}

// ---------------------------------------------------------------------------
// JSON Parse Helpers (with type guard validation)
// ---------------------------------------------------------------------------

function parseModelUsage(json: string | null | undefined): ModelUsage {
  if (!json) return {}
  try {
    const parsed: unknown = JSON.parse(json)
    if (isModelUsage(parsed)) return parsed
    return {}
  } catch {
    return {}
  }
}

function parseAgentUsage(json: string | null | undefined): AgentUsage {
  if (!json) return {}
  try {
    const parsed: unknown = JSON.parse(json)
    if (isAgentUsage(parsed)) return parsed
    return {}
  } catch {
    return {}
  }
}

// ---------------------------------------------------------------------------
// Calculation Helpers
// ---------------------------------------------------------------------------

function zeroTokenBreakdown(): TokenBreakdown {
  return { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
}

function updateModelUsage(
  current: ModelUsage,
  model: string,
  tokens: TokenBreakdown,
  cost: number
): ModelUsage {
  const existing = current[model]
  const updated: ModelUsageEntry = existing
    ? {
        message_count: existing.message_count + 1,
        tokens: {
          input: existing.tokens.input + tokens.input,
          output: existing.tokens.output + tokens.output,
          reasoning: existing.tokens.reasoning + tokens.reasoning,
          cache: {
            read: existing.tokens.cache.read + tokens.cache.read,
            write: existing.tokens.cache.write + tokens.cache.write,
          },
        },
        cost_usd: existing.cost_usd + cost,
      }
    : {
        message_count: 1,
        tokens: { ...tokens },
        cost_usd: cost,
      }

  return { ...current, [model]: updated }
}

function updateAgentUsage(
  current: AgentUsage,
  agentName: string,
  tokens: TokenBreakdown,
  cost: number
): AgentUsage {
  const existing = current[agentName]
  const updated: AgentUsageEntry = existing
    ? {
        message_count: existing.message_count + 1,
        tokens: {
          input: existing.tokens.input + tokens.input,
          output: existing.tokens.output + tokens.output,
          reasoning: existing.tokens.reasoning + tokens.reasoning,
          cache: {
            read: existing.tokens.cache.read + tokens.cache.read,
            write: existing.tokens.cache.write + tokens.cache.write,
          },
        },
        cost_usd: existing.cost_usd + cost,
      }
    : {
        message_count: 1,
        tokens: { ...tokens },
        cost_usd: cost,
      }

  return { ...current, [agentName]: updated }
}

function calculatePrimaryModel(usage: ModelUsage): string | null {
  let best: string | null = null
  let bestCount = 0
  for (const [model, entry] of Object.entries(usage)) {
    if (entry.message_count > bestCount) {
      bestCount = entry.message_count
      best = model
    }
  }
  return best
}

function calculatePrimaryAgent(usage: AgentUsage): string | null {
  let best: string | null = null
  let bestCount = 0
  for (const [agent, entry] of Object.entries(usage)) {
    if (entry.message_count > bestCount) {
      bestCount = entry.message_count
      best = agent
    }
  }
  return best
}

// ---------------------------------------------------------------------------
// Metadata Extraction Helpers
// ---------------------------------------------------------------------------

/** Safely extract a string from metadata */
function metaString(meta: Record<string, unknown>, key: string): string | null {
  const val = meta[key]
  return typeof val === "string" ? val : null
}

/** Safely extract a number from metadata */
function metaNumber(meta: Record<string, unknown>, key: string): number | null {
  const val = meta[key]
  return typeof val === "number" ? val : null
}

// ---------------------------------------------------------------------------
// Event Handlers
// ---------------------------------------------------------------------------

function handleSessionCreated(event: IngestEventEnvelope, txn: TransactionContext): void {
  const title = metaString(event.metadata, "title") ?? ""

  txn.run(
    `INSERT OR IGNORE INTO projection_sessions
      (session_id, project_path, title, status, first_event_at, last_event_at,
       model_usage, agent_usage, event_count)
     VALUES (?, ?, ?, 'active', ?, ?, '{}', '{}', 1)`,
    [event.session_id, event.project_path, title, event.timestamp_ms, event.timestamp_ms]
  )
}

function handleSessionDeleted(event: IngestEventEnvelope, txn: TransactionContext): void {
  txn.run(
    `UPDATE projection_sessions
     SET status = 'deleted', deleted_at = ?, last_event_at = ?, duration_ms = ? - first_event_at, event_count = event_count + 1
     WHERE session_id = ?`,
    [event.timestamp_ms, event.timestamp_ms, event.timestamp_ms, event.session_id]
  )
}

function handleSessionError(event: IngestEventEnvelope, txn: TransactionContext): void {
  txn.run(
    `UPDATE projection_sessions
     SET error_count = error_count + 1, last_event_at = ?, duration_ms = ? - first_event_at, event_count = event_count + 1
     WHERE session_id = ?`,
    [event.timestamp_ms, event.timestamp_ms, event.session_id]
  )
}

function handleSessionDiff(event: IngestEventEnvelope, txn: TransactionContext): void {
  const linesAdded = metaNumber(event.metadata, "lines_added") ?? 0
  const linesDeleted = metaNumber(event.metadata, "lines_deleted") ?? 0

  txn.run(
    `UPDATE projection_sessions
     SET lines_added = lines_added + ?, lines_deleted = lines_deleted + ?,
         last_event_at = ?, duration_ms = ? - first_event_at, event_count = event_count + 1
     WHERE session_id = ?`,
    [linesAdded, linesDeleted, event.timestamp_ms, event.timestamp_ms, event.session_id]
  )
}

function handleMessageUpdated(event: IngestEventEnvelope, txn: TransactionContext): void {
  const role = metaString(event.metadata, "role")
  if (!role) return

  // Read current session for JSON field updates
  const row = txn.get<{ model_usage: string | null; agent_usage: string | null }>(
    "SELECT model_usage, agent_usage FROM projection_sessions WHERE session_id = ?",
    [event.session_id]
  )
  if (!row) return // session doesn't exist yet — skip

  // Extract token breakdown from metadata
  const rawTokens = event.metadata['tokens']
  const tokens: TokenBreakdown = isTokenBreakdown(rawTokens)
    ? rawTokens
    : zeroTokenBreakdown()

  // Update message count
  if (role === "user") {
    txn.run(
      `UPDATE projection_sessions
       SET user_message_count = user_message_count + 1,
           last_event_at = ?, duration_ms = ? - first_event_at, event_count = event_count + 1
       WHERE session_id = ?`,
      [event.timestamp_ms, event.timestamp_ms, event.session_id]
    )
  } else if (role === "assistant") {
    // Update model_usage
    const modelUsage = parseModelUsage(row.model_usage)
    const updatedModelUsage = updateModelUsage(modelUsage, event.model, tokens, event.cost_usd)
    const primaryModel = calculatePrimaryModel(updatedModelUsage)

    txn.run(
      `UPDATE projection_sessions
       SET assistant_message_count = assistant_message_count + 1,
           total_tokens = total_tokens + ?,
           input_tokens = input_tokens + ?,
           output_tokens = output_tokens + ?,
           reasoning_tokens = reasoning_tokens + ?,
           cache_read = cache_read + ?,
           cache_write = cache_write + ?,
           total_cost_usd = total_cost_usd + ?,
           model_usage = ?,
           primary_model = ?,
           last_event_at = ?, duration_ms = ? - first_event_at, event_count = event_count + 1
       WHERE session_id = ?`,
      [
        event.tokens,
        tokens.input,
        tokens.output,
        tokens.reasoning,
        tokens.cache.read,
        tokens.cache.write,
        event.cost_usd,
        JSON.stringify(updatedModelUsage),
        primaryModel,
        event.timestamp_ms,
        event.timestamp_ms,
        event.session_id,
      ]
    )
  }
}

function handleToolExecuteBefore(event: IngestEventEnvelope, txn: TransactionContext): void {
  txn.run(
    `UPDATE projection_sessions
     SET tool_call_count = tool_call_count + 1, last_event_at = ?, duration_ms = ? - first_event_at, event_count = event_count + 1
     WHERE session_id = ?`,
    [event.timestamp_ms, event.timestamp_ms, event.session_id]
  )
}

function handleToolExecuteAfter(event: IngestEventEnvelope, txn: TransactionContext): void {
  const status = metaString(event.metadata, "status")
  const isError = status === "error" || event.status === "failed"

  if (isError) {
    txn.run(
      `UPDATE projection_sessions
       SET tool_error_count = tool_error_count + 1, last_event_at = ?, duration_ms = ? - first_event_at, event_count = event_count + 1
       WHERE session_id = ?`,
      [event.timestamp_ms, event.timestamp_ms, event.session_id]
    )
  } else {
    txn.run(
      `UPDATE projection_sessions
       SET last_event_at = ?, duration_ms = ? - first_event_at, event_count = event_count + 1
       WHERE session_id = ?`,
      [event.timestamp_ms, event.timestamp_ms, event.session_id]
    )
  }
}

function handleFileEdited(event: IngestEventEnvelope, txn: TransactionContext): void {
  const additions = metaNumber(event.metadata, "additions") ?? 0
  const deletions = metaNumber(event.metadata, "deletions") ?? 0

  txn.run(
    `UPDATE projection_sessions
     SET files_edited = files_edited + 1,
         lines_added = lines_added + ?,
         lines_deleted = lines_deleted + ?,
         last_event_at = ?, duration_ms = ? - first_event_at, event_count = event_count + 1
     WHERE session_id = ?`,
    [additions, deletions, event.timestamp_ms, event.timestamp_ms, event.session_id]
  )
}

function handleAgentCompleted(event: IngestEventEnvelope, txn: TransactionContext): void {
  const agentName = metaString(event.metadata, "agent_name")
  if (!agentName) return

  // Read current agent_usage
  const row = txn.get<{ agent_usage: string | null }>(
    "SELECT agent_usage FROM projection_sessions WHERE session_id = ?",
    [event.session_id]
  )
  if (!row) return

  const rawTokens = event.metadata['tokens']
  const tokens: TokenBreakdown = isTokenBreakdown(rawTokens)
    ? rawTokens
    : zeroTokenBreakdown()

  const agentUsage = parseAgentUsage(row.agent_usage)
  const updatedAgentUsage = updateAgentUsage(agentUsage, agentName, tokens, event.cost_usd)
  const primaryAgent = calculatePrimaryAgent(updatedAgentUsage)

  txn.run(
    `UPDATE projection_sessions
     SET agent_usage = ?, primary_agent = ?,
         total_tokens = total_tokens + ?,
         input_tokens = input_tokens + ?,
         output_tokens = output_tokens + ?,
         reasoning_tokens = reasoning_tokens + ?,
         cache_read = cache_read + ?,
         cache_write = cache_write + ?,
         total_cost_usd = total_cost_usd + ?,
         last_event_at = ?, duration_ms = ? - first_event_at, event_count = event_count + 1
     WHERE session_id = ?`,
    [
      JSON.stringify(updatedAgentUsage),
      primaryAgent,
      event.tokens,
      tokens.input,
      tokens.output,
      tokens.reasoning,
      tokens.cache.read,
      tokens.cache.write,
      event.cost_usd,
      event.timestamp_ms,
      event.timestamp_ms,
      event.session_id,
    ]
  )
}

// ---------------------------------------------------------------------------
// Handler Factory
// ---------------------------------------------------------------------------

const HANDLED_EVENTS: EventType[] = [
  "session.created",
  "session.updated",
  "session.deleted",
  "session.error",
  "session.diff",
  "message.created",
  "message.updated",
  "message.deleted",
  "tool.execute.before",
  "tool.execute.after",
  "file.edited",
  "file.created",
  "file.deleted",
  "agent.started",
  "agent.completed",
  "agent.failed",
]

/**
 * Create a ProjectionHandler that materializes projection_sessions.
 *
 * Exported as a factory function for testability and engine registration.
 */
export function createSessionProjectionHandler(): ProjectionHandler {
  return {
    handles: HANDLED_EVENTS,

    handle(event: IngestEventEnvelope, txn: TransactionContext): void {
      switch (event.event_type) {
        case "session.created":
          handleSessionCreated(event, txn)
          break

        case "session.deleted":
          handleSessionDeleted(event, txn)
          break

        case "session.error":
          handleSessionError(event, txn)
          break

        case "session.diff":
          handleSessionDiff(event, txn)
          break

        case "message.updated":
          handleMessageUpdated(event, txn)
          break

        case "tool.execute.before":
          handleToolExecuteBefore(event, txn)
          break

        case "tool.execute.after":
          handleToolExecuteAfter(event, txn)
          break

        case "file.edited":
          handleFileEdited(event, txn)
          break

        case "agent.completed":
          handleAgentCompleted(event, txn)
          break

        // Events we handle but don't need specific logic for yet:
        // session.updated, message.created, message.deleted,
        // file.created, file.deleted, agent.started, agent.failed
        default:
          break
      }
    },
  }
}
