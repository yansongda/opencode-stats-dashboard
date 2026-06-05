/**
 * DailyProjectionHandler — aggregates events into projection_daily.
 *
 * Handles: session.*, message.*, tool.*, file.*, agent.* events.
 * Aggregates by composite key: (date, project_path, model).
 * Uses INSERT … ON CONFLICT DO UPDATE for upsert semantics.
 */

import type { ProjectionHandler, TransactionContext } from "./handlers/types"
import type { IngestEventEnvelope, EventType } from "../types/events"
import type { AgentUsage, AgentUsageEntry } from "../types/projections"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert epoch milliseconds to UTC YYYY-MM-DD string. */
function toDateKey(ms: number): string {
  const d = new Date(ms)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, "0")
  const day = String(d.getUTCDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

/** Safely extract a numeric nested property, defaulting to 0. */
function num(obj: unknown, ...keys: string[]): number {
  let current: any = obj
  for (const key of keys) {
    if (current == null || typeof current !== "object") return 0
    current = current[key]
  }
  return typeof current === "number" ? current : 0
}

/** Extract agent name from event metadata, if present. */
function extractAgent(metadata: Record<string, unknown>): string | null {
  const agent = metadata["agent"]
  return typeof agent === "string" ? agent : null
}

/** Extract token breakdown from event metadata. */
function extractTokenBreakdown(metadata: Record<string, unknown>): {
  input: number
  output: number
  reasoning: number
  cache_read: number
  cache_write: number
} {
  const tokens = metadata["tokens"]
  if (tokens == null || typeof tokens !== "object") {
    return { input: 0, output: 0, reasoning: 0, cache_read: 0, cache_write: 0 }
  }
  return {
    input: num(tokens, "input"),
    output: num(tokens, "output"),
    reasoning: num(tokens, "reasoning"),
    cache_read: num(tokens, "cache", "read"),
    cache_write: num(tokens, "cache", "write"),
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export class DailyProjectionHandler implements ProjectionHandler {
  readonly handles: EventType[] = [
    // Session
    "session.created",
    "session.updated",
    "session.deleted",
    "session.error",
    // Messages
    "message.created",
    "message.updated",
    "message.deleted",
    // Tools
    "tool.started",
    "tool.completed",
    "tool.failed",
    "tool.execute.before",
    "tool.execute.after",
    // Files
    "file.edited",
    // Agent
    "agent.started",
    "agent.completed",
    "agent.failed",
  ]

  handle(event: IngestEventEnvelope, txn: TransactionContext): void {
    const date = toDateKey(event.timestamp_ms)
    const { project_path, model } = event

    // Ensure a row exists, then increment event_count
    this.ensureRow(txn, date, project_path, model)
    this.incField(txn, date, project_path, model, "event_count")

    switch (event.event_type) {
      case "message.created":
      case "message.updated":
        this.handleMessage(event, txn, date, project_path, model)
        break

      case "message.deleted":
        // Only event_count
        break

      case "session.created":
        this.incField(txn, date, project_path, model, "session_count")
        this.incField(txn, date, project_path, model, "active_sessions")
        break

      case "session.deleted":
        this.incField(txn, date, project_path, model, "session_count")
        this.incField(txn, date, project_path, model, "deleted_sessions")
        break

      case "session.updated":
        // Only event_count (already incremented above)
        break

      case "session.error":
        this.incField(txn, date, project_path, model, "error_count")
        break

      case "tool.started":
      case "tool.completed":
      case "tool.execute.before":
      case "tool.execute.after":
        this.handleTool(event, txn, date, project_path, model)
        break

      case "tool.failed":
        this.handleToolFailed(event, txn, date, project_path, model)
        break

      case "file.edited":
        this.handleFileEdited(event, txn, date, project_path, model)
        break

      case "agent.started":
      case "agent.completed":
      case "agent.failed":
        // Agent events contribute to agent_usage and potentially tokens
        this.handleAgentEvent(event, txn, date, project_path, model)
        break
    }
  }

  // =========================================================================
  // Event Handlers
  // =========================================================================

  private handleMessage(
    event: IngestEventEnvelope,
    txn: TransactionContext,
    date: string,
    project: string,
    model: string
  ): void {
    const role = event.metadata["role"]
    this.incField(txn, date, project, model, "message_count")
    if (role === "user") {
      this.incField(txn, date, project, model, "user_messages")
    } else if (role === "assistant") {
      this.incField(txn, date, project, model, "assistant_messages")
    }

    // Tokens
    if (event.tokens > 0) {
      this.incFieldBy(txn, date, project, model, "total_tokens", event.tokens)
    }
    if (event.cost_usd > 0) {
      this.incFieldBy(txn, date, project, model, "total_cost_usd", event.cost_usd)
    }

    // Token breakdown from metadata
    const tb = extractTokenBreakdown(event.metadata)
    if (tb.input > 0) this.incFieldBy(txn, date, project, model, "input_tokens", tb.input)
    if (tb.output > 0) this.incFieldBy(txn, date, project, model, "output_tokens", tb.output)
    if (tb.reasoning > 0) this.incFieldBy(txn, date, project, model, "reasoning_tokens", tb.reasoning)
    if (tb.cache_read > 0) this.incFieldBy(txn, date, project, model, "cache_read", tb.cache_read)
    if (tb.cache_write > 0) this.incFieldBy(txn, date, project, model, "cache_write", tb.cache_write)

    // Agent usage
    const agent = extractAgent(event.metadata)
    if (agent) {
      this.updateAgentUsage(txn, date, project, model, agent, {
        message_count: 1,
        tokens: {
          input: tb.input,
          output: tb.output,
          reasoning: tb.reasoning,
          cache: { read: tb.cache_read, write: tb.cache_write },
        },
        cost_usd: event.cost_usd,
      })
    }
  }

  private handleTool(
    event: IngestEventEnvelope,
    txn: TransactionContext,
    date: string,
    project: string,
    model: string
  ): void {
    this.incField(txn, date, project, model, "tool_calls")
    if (event.tokens > 0) {
      this.incFieldBy(txn, date, project, model, "total_tokens", event.tokens)
    }
    if (event.cost_usd > 0) {
      this.incFieldBy(txn, date, project, model, "total_cost_usd", event.cost_usd)
    }
  }

  private handleToolFailed(
    _event: IngestEventEnvelope,
    txn: TransactionContext,
    date: string,
    project: string,
    model: string
  ): void {
    this.incField(txn, date, project, model, "tool_calls")
    this.incField(txn, date, project, model, "tool_errors")
  }

  private handleFileEdited(
    event: IngestEventEnvelope,
    txn: TransactionContext,
    date: string,
    project: string,
    model: string
  ): void {
    this.incField(txn, date, project, model, "files_edited")
    const additions = num(event.metadata, "additions")
    const deletions = num(event.metadata, "deletions")
    if (additions > 0) this.incFieldBy(txn, date, project, model, "lines_added", additions)
    if (deletions > 0) this.incFieldBy(txn, date, project, model, "lines_deleted", deletions)
  }

  private handleAgentEvent(
    event: IngestEventEnvelope,
    txn: TransactionContext,
    date: string,
    project: string,
    model: string
  ): void {
    if (event.tokens > 0) {
      this.incFieldBy(txn, date, project, model, "total_tokens", event.tokens)
    }
    if (event.cost_usd > 0) {
      this.incFieldBy(txn, date, project, model, "total_cost_usd", event.cost_usd)
    }

    const agent = extractAgent(event.metadata)
    if (agent) {
      const tb = extractTokenBreakdown(event.metadata)
      this.updateAgentUsage(txn, date, project, model, agent, {
        message_count: 0,
        tokens: {
          input: tb.input,
          output: tb.output,
          reasoning: tb.reasoning,
          cache: { read: tb.cache_read, write: tb.cache_write },
        },
        cost_usd: event.cost_usd,
      })
    }
  }

  // =========================================================================
  // SQL Helpers
  // =========================================================================

  /** Ensure a row exists for the given composite key (no-op if already exists). */
  private ensureRow(
    txn: TransactionContext,
    date: string,
    project: string,
    model: string
  ): void {
    txn.run(
      `INSERT INTO projection_daily (date, project_path, model)
       VALUES (?, ?, ?)
       ON CONFLICT (date, project_path, model) DO NOTHING`,
      [date, project, model]
    )
  }

  /** Increment a numeric field by 1. */
  private incField(
    txn: TransactionContext,
    date: string,
    project: string,
    model: string,
    field: string
  ): void {
    txn.run(
      `UPDATE projection_daily SET ${field} = ${field} + 1, projected_at = CURRENT_TIMESTAMP
       WHERE date = ? AND project_path = ? AND model = ?`,
      [date, project, model]
    )
  }

  /** Increment a numeric field by an arbitrary amount. */
  private incFieldBy(
    txn: TransactionContext,
    date: string,
    project: string,
    model: string,
    field: string,
    value: number
  ): void {
    txn.run(
      `UPDATE projection_daily SET ${field} = ${field} + ?, projected_at = CURRENT_TIMESTAMP
       WHERE date = ? AND project_path = ? AND model = ?`,
      [value, date, project, model]
    )
  }

  /**
   * Update agent_usage JSON field.
   *
   * Pattern: read current JSON → mutate → write back.
   * Handles the null/empty initial state.
   */
  private updateAgentUsage(
    txn: TransactionContext,
    date: string,
    project: string,
    model: string,
    agentName: string,
    delta: AgentUsageEntry
  ): void {
    const row = txn.get<{ agent_usage: string | null }>(
      `SELECT agent_usage FROM projection_daily
       WHERE date = ? AND project_path = ? AND model = ?`,
      [date, project, model]
    )

    let usage: AgentUsage = {}
    if (row?.agent_usage) {
      try {
        usage = JSON.parse(row.agent_usage) as AgentUsage
      } catch {
        usage = {}
      }
    }

    const existing = usage[agentName]
    if (existing) {
      existing.message_count += delta.message_count
      existing.cost_usd += delta.cost_usd
      existing.tokens.input += delta.tokens.input
      existing.tokens.output += delta.tokens.output
      existing.tokens.reasoning += delta.tokens.reasoning
      existing.tokens.cache.read += delta.tokens.cache.read
      existing.tokens.cache.write += delta.tokens.cache.write
    } else {
      usage[agentName] = { ...delta }
    }

    txn.run(
      `UPDATE projection_daily SET agent_usage = ?, projected_at = CURRENT_TIMESTAMP
       WHERE date = ? AND project_path = ? AND model = ?`,
      [JSON.stringify(usage), date, project, model]
    )
  }
}
