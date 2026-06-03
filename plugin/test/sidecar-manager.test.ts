import { describe, test, expect, afterEach } from "bun:test"
import { SidecarManager } from "../src/sidecar/manager"

const TIMEOUT_MS = 15_000

describe("SidecarManager", () => {
  let manager: SidecarManager | null = null

  afterEach(async () => {
    if (manager) {
      await manager.stop()
      manager = null
    }
  })

  test(
    "start() spawns sidecar and returns URL",
    async () => {
      manager = new SidecarManager({ timeoutMs: TIMEOUT_MS })
      const url = await manager.start()

      expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
      expect(manager.getUrl()).toBe(url)
    },
    TIMEOUT_MS + 5000,
  )

  test(
    "isHealthy() returns true after start",
    async () => {
      manager = new SidecarManager({ timeoutMs: TIMEOUT_MS })
      await manager.start()

      const healthy = await manager.isHealthy()
      expect(healthy).toBe(true)
    },
    TIMEOUT_MS + 5000,
  )

  test(
    "stop() terminates the process",
    async () => {
      manager = new SidecarManager({ timeoutMs: TIMEOUT_MS })
      await manager.start()
      await manager.stop()

      // After stop, getUrl should throw
      expect(() => manager.getUrl()).toThrow("Sidecar is not running")

      // After stop, isHealthy should return false
      const healthy = await manager.isHealthy()
      expect(healthy).toBe(false)

      manager = null
    },
    TIMEOUT_MS + 5000,
  )

  test("start() throws if already running", async () => {
    manager = new SidecarManager({ timeoutMs: TIMEOUT_MS })
    await manager.start()

    await expect(manager.start()).rejects.toThrow(
      "SidecarManager is already running",
    )
  })
})
