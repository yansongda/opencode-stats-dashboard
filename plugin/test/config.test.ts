import { test, expect } from "bun:test"
import { loadConfig } from "../src/config"

test("loadConfig returns defaults when no input", () => {
  const config = loadConfig({})
  expect(config.host).toBe("127.0.0.1")
  expect(config.persistFullPayloads).toBe(false)
})

test("loadConfig rejects host=0.0.0.0", () => {
  expect(() => loadConfig({ host: "0.0.0.0" })).toThrow("remote_bind_not_allowed")
})

test("loadConfig rejects remote IP", () => {
  expect(() => loadConfig({ host: "192.168.1.100" })).toThrow("remote_bind_not_allowed")
})

test("loadConfig rejects IPv6 non-loopback", () => {
  expect(() => loadConfig({ host: "::1" })).toThrow("remote_bind_not_allowed")
})

test("loadConfig accepts 127.0.0.1", () => {
  const config = loadConfig({ host: "127.0.0.1" })
  expect(config.host).toBe("127.0.0.1")
})

test("loadConfig accepts localhost", () => {
  const config = loadConfig({ host: "localhost" })
  expect(config.host).toBe("localhost")
})

test("loadConfig privacy defaults: persistFullPayloads is false", () => {
  const config = loadConfig({})
  expect(config.persistFullPayloads).toBe(false)
})
