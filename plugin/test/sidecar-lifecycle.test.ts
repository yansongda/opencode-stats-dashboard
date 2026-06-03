import { test, expect } from "bun:test"
import { resolve } from "path"

const SIDECAR_BIN = resolve(__dirname, "../../sidecar/target/debug/sidecar-api")
const TIMEOUT_MS = 10_000

/**
 * 从 sidecar 进程的 stdout 中解析监听地址
 * sidecar 输出格式: "Listening on Ok(127.0.0.1:PORT)"
 * 注意：Ok() 包装是因为 Rust 的 acceptor.local_addr() 返回 Result 类型
 */
async function waitForListeningUrl(
  proc: Bun.Subprocess,
  timeoutMs: number,
): Promise<string> {
  const deadline = Date.now() + timeoutMs
  const reader = proc.stdout!.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  while (Date.now() < deadline) {
    const { value, done } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })

    // 解析 "Listening on Ok(127.0.0.1:PORT)" 格式
    const match = buffer.match(/Listening on Ok\((\d+\.\d+\.\d+\.\d+:\d+)\)/)
    if (match) {
      const addr = match[1]
      reader.releaseLock()
      return `http://${addr}`
    }
  }

  reader.releaseLock()
  throw new Error(`Timeout: failed to parse listening address within ${timeoutMs}ms`)
}

test(
  "sidecar lifecycle: spawn, health check, shutdown",
  async () => {
    // 1. 生成 sidecar 二进制进程
    const proc = Bun.spawn([SIDECAR_BIN], {
      stdout: "pipe",
      stderr: "inherit",
    })

    let healthUrl: string
    try {
      // 2. 从 stdout 解析动态端口/URL
      healthUrl = await waitForListeningUrl(proc, TIMEOUT_MS)
      expect(healthUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)

      // 3. 等待 /health 端点返回 ok
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS)

      let healthOk = false
      const deadline = Date.now() + TIMEOUT_MS

      while (Date.now() < deadline && !healthOk) {
        try {
          const res = await fetch(`${healthUrl}/health`, {
            signal: controller.signal,
          })
          if (res.ok) {
            const body = await res.json()
            expect(body.status).toBe("ok")
            expect(body.version).toBe("dev")
            healthOk = true
          }
        } catch {
          // 连接可能还没就绪，重试
          await Bun.sleep(100)
        }
      }

      clearTimeout(timeoutId)
      expect(healthOk).toBe(true)
    } finally {
      proc.kill("SIGTERM")
      await proc.exited
      expect(proc.exitCode).toBeDefined()
    }
  },
  TIMEOUT_MS + 5000,
)
