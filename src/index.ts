import { appendFileSync, mkdirSync } from "fs"
import { homedir } from "os"
import { join } from "path"
import { Database } from "bun:sqlite"
import type { Plugin, PluginInput, Hooks } from "@opencode-ai/plugin"

import { runMigrations } from "./db/schema"
import { insertEvent } from "./db/event"
import { processSessionEvent, processToolEvent } from "./db/reducer"
import { createServer, type SSEBroadcaster } from "./server/api"
import { buildToolEnvelope, buildSdkEnvelope } from "./events/mapper"
import type { IngestEventEnvelope } from "./types"

const DEBUG_LOG = join(import.meta.dir, "..", "..", "opencode-stats-plugin.log")
const DB_DIR = join(homedir(), ".local", "share", "opencode-stats-dashboard")
const DB_PATH = join(DB_DIR, "opencode-stats.db")
const PORT = 11133

function log(msg: string): void {
  try {
    appendFileSync(DEBUG_LOG, `${new Date().toISOString()} ${msg}\n`)
  } catch {
    // ignore
  }
}

function ingestEvent(db: Database, envelope: IngestEventEnvelope, broadcaster: SSEBroadcaster): void {
  const result = insertEvent(db, envelope)
  if (result === "accepted") {
    processSessionEvent(db, envelope)
    processToolEvent(db, envelope)
    log(`ingest: event_id=${envelope.event_id} type=${envelope.event_type}`)
    
    // Broadcast SSE update for real-time dashboard updates
    broadcaster.broadcast({
      last_event_id: envelope.event_id,
      updated_at: new Date().toISOString(),
    })
  } else {
    log(`ingest: event_id=${envelope.event_id} duplicate`)
  }
}

async function showToastWithRetry(
  input: PluginInput,
  url: string,
): Promise<void> {
  if (!input.client?.tui?.showToast) return

  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      await input.client.tui.showToast({
        body: {
          title: "Stats Dashboard",
          message: `Dashboard: ${url}`,
          variant: "success",
          duration: 10_000,
        },
      })
      return
    } catch {
      await new Promise((r) => setTimeout(r, 1000))
    }
  }
}

const statsPlugin: Plugin = async (input: PluginInput) => {
  log(`activate: starting embedded server (db=${DB_PATH})`)

  mkdirSync(DB_DIR, { recursive: true })
  const db = new Database(DB_PATH)
  runMigrations(db)

  const { url, broadcaster } = createServer(db, PORT)
  log(`activate: server started at ${url}`)
  console.log(`Dashboard: ${url}`)

  void showToastWithRetry(input, url)

  const hooks: Hooks = {
    event: async ({ event }) => {
      const envelope = buildSdkEnvelope(event)
      if (envelope) {
        ingestEvent(db, envelope, broadcaster)
      }
    },

    "tool.execute.before": async (input, _output) => {
      ingestEvent(db, buildToolEnvelope(input.sessionID, input.tool, input.callID, "started"), broadcaster)
    },

    "tool.execute.after": async (input, output) => {
      ingestEvent(db, buildToolEnvelope(
        input.sessionID,
        input.tool,
        input.callID,
        "completed",
        output.title?.slice(0, 200),
      ), broadcaster)
    },

    dispose: async () => {
      log("dispose: closing database")
      db.close()
    },
  }

  return hooks
}

export default statsPlugin
