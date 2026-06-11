/**
 * Creates a debounced version of `fn` with trailing-edge semantics and a
 * `maxWait` ceiling. The debounced function delays execution until `wait`
 * milliseconds have elapsed since the last invocation, but guarantees
 * execution within `maxWait` milliseconds of the first call in a burst.
 *
 * - No leading-edge execution.
 * - The most recent arguments are preserved and used for the trailing call.
 * - `cancel()` discards pending work without triggering `fn`.
 * - `flush()` immediately executes pending work (if any).
 * - `pending()` returns `true` while unflushed work exists.
 */
export function createDebouncedWithMaxWait<T extends (...args: never[]) => unknown>(
  fn: T,
  wait: number,
  maxWait: number,
): {
  (...args: Parameters<T>): void
  cancel: () => void
  flush: () => void
  pending: () => boolean
} {
  let waitTimer: ReturnType<typeof setTimeout> | undefined
  let maxTimer: ReturnType<typeof setTimeout> | undefined
  let firstCallTimestamp: number | undefined
  let latestArgs: Parameters<T> | undefined

  function clearTimers(): void {
    if (waitTimer !== undefined) {
      clearTimeout(waitTimer)
      waitTimer = undefined
    }
    if (maxTimer !== undefined) {
      clearTimeout(maxTimer)
      maxTimer = undefined
    }
  }

  function invoke(): void {
    clearTimers()
    firstCallTimestamp = undefined
    if (latestArgs !== undefined) {
      const args = latestArgs
      latestArgs = undefined
      fn(...args)
    }
  }

  function debounced(this: unknown, ...args: Parameters<T>): void {
    latestArgs = args
    const now = Date.now()

    // Record the first call in a burst
    if (firstCallTimestamp === undefined) {
      firstCallTimestamp = now
    }

    // Always reset the trailing-edge wait timer
    if (waitTimer !== undefined) {
      clearTimeout(waitTimer)
    }
    waitTimer = setTimeout(invoke, wait)

    // Start the maxWait ceiling timer only once per burst
    if (maxTimer === undefined) {
      const remaining = maxWait - (now - firstCallTimestamp)
      if (remaining <= 0) {
        // Already past maxWait — execute on next microtask
        invoke()
      } else {
        maxTimer = setTimeout(invoke, remaining)
      }
    }
  }

  debounced.cancel = (): void => {
    clearTimers()
    firstCallTimestamp = undefined
    latestArgs = undefined
  }

  debounced.flush = invoke

  debounced.pending = (): boolean => {
    return waitTimer !== undefined || maxTimer !== undefined
  }

  return debounced
}
