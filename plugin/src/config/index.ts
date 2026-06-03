/**
 * Plugin configuration with local-only security guard.
 *
 * Rejects any host that would expose the sidecar to the network.
 */

export interface PluginConfig {
  /** Bind address for the sidecar HTTP server */
  host: string
  /** Whether to persist full tool payloads (privacy-sensitive) */
  persistFullPayloads: boolean
}

interface RawConfig {
  host?: string
  persistFullPayloads?: boolean
}

/**
 * Loopback addresses that are safe to bind to.
 * Anything else is rejected with `remote_bind_not_allowed`.
 */
const SAFE_HOSTS = new Set(["127.0.0.1", "localhost"])

/**
 * Load and validate plugin configuration.
 *
 * @throws {Error} with code `remote_bind_not_allowed` if host is not loopback
 */
export function loadConfig(raw: RawConfig = {}): PluginConfig {
  const host = raw.host ?? "127.0.0.1"
  const persistFullPayloads = raw.persistFullPayloads ?? false

  if (!SAFE_HOSTS.has(host)) {
    throw new Error("remote_bind_not_allowed")
  }

  return { host, persistFullPayloads }
}
