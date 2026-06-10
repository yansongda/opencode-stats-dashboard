/** @module format — Shared dashboard formatting utilities. */

export function formatTokens(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n === 0) return '0'
  if (n >= 1_000_000_000) {
    const v = n / 1_000_000_000
    const s = v.toFixed(1)
    return s.endsWith('.0') ? `${s.slice(0, -2)}B` : `${s}B`
  }
  if (n >= 1_000_000) {
    const v = n / 1_000_000
    const s = v.toFixed(1)
    return s.endsWith('.0') ? `${s.slice(0, -2)}M` : `${s}M`
  }
  if (n >= 1_000) {
    const v = n / 1_000
    const s = v.toFixed(1)
    return s.endsWith('.0') ? `${s.slice(0, -2)}K` : `${s}K`
  }
  return String(n)
}

export function formatCost(n: number | null | undefined, decimals = 2): string {
  if (n == null) return '—'
  return `$${n.toFixed(decimals)}`
}

export function formatNumber(n: number | null | undefined): string {
  if (n == null) return '—'
  return n.toLocaleString('en-US')
}
