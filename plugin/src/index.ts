/**
 * OpenCode Stats Plugin
 *
 * Collects session statistics from OpenCode events.
 * This is a scaffolding - business logic will be added in subsequent tasks.
 */

import { SidecarManager } from "./sidecar/manager"

export interface PluginContext {
  project: unknown
  client: unknown
  $: unknown
  directory: string
  worktree: string
}

export interface PluginHooks {
  [key: string]: (...args: unknown[]) => Promise<unknown> | unknown
}

/**
 * Plugin activation function.
 * Called by OpenCode to initialize the plugin and register event hooks.
 *
 * Starts the sidecar process and prints the dashboard URL to the console.
 * The sidecar health status is logged to confirm the dashboard is accessible.
 */
export async function activate(_ctx: PluginContext): Promise<PluginHooks> {
  const manager = new SidecarManager()

  try {
    const url = await manager.start()
    const healthy = await manager.isHealthy()

    console.log(`Dashboard: ${url}`)
    console.log(`Sidecar health: ${healthy ? "ok" : "unhealthy"}`)
  } catch (err) {
    console.error(`Failed to start sidecar: ${err}`)
    throw err
  }

  return {}
}
