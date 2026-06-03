import { describe, test, expect, afterEach, spyOn } from "bun:test"
import { activate } from "../src/index"
import type { PluginContext } from "../src/index"

describe("startup-url", () => {
  let consoleSpy: ReturnType<typeof spyOn>

  afterEach(async () => {
    consoleSpy?.mockRestore()
  })

  test(
    "activate() prints Dashboard URL with 127.0.0.1",
    async () => {
      const logs: string[] = []
      consoleSpy = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
        logs.push(args.join(" "))
      })

      const ctx: PluginContext = {
        project: {},
        client: {},
        $: {},
        directory: "/tmp",
        worktree: "/tmp",
      }

      const hooks = await activate(ctx)
      expect(hooks).toBeDefined()

      const dashboardLog = logs.find((l) => l.startsWith("Dashboard:"))
      expect(dashboardLog).toBeDefined()
      expect(dashboardLog).toMatch(/Dashboard: http:\/\/127\.0\.0\.1:\d+/)
    },
    20_000,
  )

  test(
    "activate() does not expose 0.0.0.0 or remote hosts",
    async () => {
      const logs: string[] = []
      consoleSpy = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
        logs.push(args.join(" "))
      })

      const ctx: PluginContext = {
        project: {},
        client: {},
        $: {},
        directory: "/tmp",
        worktree: "/tmp",
      }

      await activate(ctx)

      const dashboardLog = logs.find((l) => l.startsWith("Dashboard:"))
      expect(dashboardLog).toBeDefined()
      expect(dashboardLog).not.toContain("0.0.0.0")
      expect(dashboardLog).not.toContain("localhost")
      expect(dashboardLog).not.toContain("::")
    },
    20_000,
  )
})
