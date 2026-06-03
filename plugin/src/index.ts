import { appendFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

import { SidecarManager } from "./sidecar/manager"

const DEBUG_LOG = join(tmpdir(), "opencode-stats-plugin.log")

function log(msg: string): void {
  try {
    appendFileSync(DEBUG_LOG, `${new Date().toISOString()} ${msg}\n`)
  } catch {
    // ignore - logging must never break the plugin
  }
}

export interface PluginInput {
  project: unknown
  client: {
    tui?: {
      showToast?: (options: {
        body: {
          title?: string
          message: string
          variant: "info" | "success" | "warning" | "error"
          duration?: number
        }
      }) => Promise<unknown>
    }
  }
  $: unknown
  directory: string
  worktree: string
}

export interface Hooks {
  dispose?: () => Promise<void>
  [key: string]: ((...args: unknown[]) => Promise<unknown> | unknown) | undefined
}

async function showToastWithRetry(
  input: PluginInput,
  url: string,
  healthy: boolean,
): Promise<void> {
  if (!input.client?.tui?.showToast) {
    log("toast: client.tui.showToast unavailable - skipping")
    return
  }

  const maxAttempts = 10
  const intervalMs = 1000

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await input.client.tui.showToast({
        body: {
          title: "Stats Dashboard",
          message: `Dashboard: ${url}`,
          variant: healthy ? "success" : "warning",
          duration: 10_000,
        },
      })
      log(`toast: shown on attempt ${attempt}`)
      return
    } catch (err) {
      log(`toast: attempt ${attempt}/${maxAttempts} failed: ${String(err)}`)
      if (attempt === maxAttempts) {
        log("toast: giving up after max attempts")
        return
      }
      await new Promise((r) => setTimeout(r, intervalMs))
    }
  }
}

export default async function activate(input: PluginInput): Promise<Hooks> {
  log(`activate: enter (log file: ${DEBUG_LOG})`)
  const manager = new SidecarManager()

  let url: string
  let healthy: boolean
  try {
    url = await manager.start()
    healthy = await manager.isHealthy()
    log(`activate: sidecar started url=${url} healthy=${healthy}`)
  } catch (err) {
    log(`activate: sidecar start FAILED: ${String(err)}`)
    throw err
  }

  void showToastWithRetry(input, url, healthy)

  return {
    dispose: async () => {
      log("dispose: stopping sidecar")
      await manager.stop()
      log("dispose: sidecar stopped")
    },
  }
}
