import { test, expect } from "bun:test"
import statsPlugin from "../src/index"

test("default export is a function", () => {
  expect(typeof statsPlugin).toBe("function")
})

test("default export returns hooks object", async () => {
  const ctx = {
    project: {},
    client: {},
    $: {},
    directory: "/tmp",
    worktree: "/tmp",
  }

  const hooks = await statsPlugin(ctx as any)
  expect(hooks).toBeDefined()
  expect(typeof hooks).toBe("object")
})
