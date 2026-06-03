import { test, expect } from "bun:test"
import { activate } from "../src/index"

test("activate exports a function", () => {
  expect(typeof activate).toBe("function")
})

test("activate returns hooks object", async () => {
  const ctx = {
    project: {},
    client: {},
    $: {},
    directory: "/tmp",
    worktree: "/tmp",
  }

  const hooks = await activate(ctx)
  expect(hooks).toBeDefined()
  expect(typeof hooks).toBe("object")
})
