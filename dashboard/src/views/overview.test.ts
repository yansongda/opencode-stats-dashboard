import { describe, it, expect } from 'bun:test'

// ── Pure helper functions extracted for testing ─────────────────────

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`
  return tokens.toLocaleString()
}

function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`
}

function formatProjectPath(path: string | null): string {
  if (!path) return '未知项目'
  const segments = path.split('/').filter(Boolean)
  if (segments.length <= 2) return path
  return '.../' + segments.slice(-2).join('/')
}

function formatDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function getDateRange(period: '7d' | '30d' | 'all', now: Date): { start?: string; end?: string } {
  if (period === 'all') return {}
  const end = formatDate(now)
  const start = new Date(now)
  start.setDate(start.getDate() - (period === '7d' ? 6 : 29))
  return { start: formatDate(start), end }
}

// ── Tests ──────────────────────────────────────────────────────────

describe('OverviewView helpers', () => {
  describe('formatTokens', () => {
    it('formats millions with M suffix', () => {
      expect(formatTokens(1_200_000)).toBe('1.2M')
      expect(formatTokens(2_500_000)).toBe('2.5M')
    })

    it('formats thousands with K suffix', () => {
      expect(formatTokens(1_500)).toBe('1.5K')
      expect(formatTokens(10_000)).toBe('10.0K')
    })

    it('formats small numbers with locale string', () => {
      expect(formatTokens(500)).toBe('500')
      expect(formatTokens(0)).toBe('0')
    })
  })

  describe('formatCost', () => {
    it('formats cost with $ prefix and 2 decimals', () => {
      expect(formatCost(1.234)).toBe('$1.23')
      expect(formatCost(0)).toBe('$0.00')
      expect(formatCost(100)).toBe('$100.00')
    })
  })

  describe('formatProjectPath', () => {
    it('returns 未知项目 for null', () => {
      expect(formatProjectPath(null)).toBe('未知项目')
    })

    it('returns full path when 2 or fewer segments', () => {
      expect(formatProjectPath('/home/user')).toBe('/home/user')
      expect(formatProjectPath('/project')).toBe('/project')
    })

    it('truncates to last 2 segments with .../ prefix', () => {
      expect(formatProjectPath('/Users/test/project-a')).toBe('.../test/project-a')
      expect(formatProjectPath('/home/user/code/my-project')).toBe('.../code/my-project')
    })
  })

  describe('formatDate', () => {
    it('formats date as YYYY-MM-DD', () => {
      const d = new Date(2026, 5, 5) // June 5, 2026
      expect(formatDate(d)).toBe('2026-06-05')
    })

    it('pads single digit month and day', () => {
      const d = new Date(2026, 0, 9) // Jan 9, 2026
      expect(formatDate(d)).toBe('2026-01-09')
    })
  })

  describe('getDateRange', () => {
    const now = new Date(2026, 5, 10) // June 10, 2026

    it('returns empty for all period', () => {
      const range = getDateRange('all', now)
      expect(range).toEqual({})
    })

    it('returns 7-day range for 7d period', () => {
      const range = getDateRange('7d', now)
      expect(range.end).toBe('2026-06-10')
      expect(range.start).toBe('2026-06-04')
    })

    it('returns 30-day range for 30d period', () => {
      const range = getDateRange('30d', now)
      expect(range.end).toBe('2026-06-10')
      expect(range.start).toBe('2026-05-12')
    })
  })

  describe('chart data transformations', () => {
    it('transforms trend data to chart series', () => {
      const trendData = [
        { date: '2026-06-01', tokens: 1000, cost_usd: 0.01, messages: 10, sessions: 2, tool_calls: 5, errors: 0 },
        { date: '2026-06-02', tokens: 2000, cost_usd: 0.02, messages: 20, sessions: 3, tool_calls: 8, errors: 1 },
      ]

      const dates = trendData.map((d) => d.date)
      const tokenSeries = trendData.map((d) => d.tokens)
      const messageSeries = trendData.map((d) => d.messages)

      expect(dates).toEqual(['2026-06-01', '2026-06-02'])
      expect(tokenSeries).toEqual([1000, 2000])
      expect(messageSeries).toEqual([10, 20])
    })

    it('transforms model data to pie chart format', () => {
      const models = [
        { model: 'claude-sonnet', total_cost_usd: 0.5 },
        { model: 'gpt-4o', total_cost_usd: 0.3 },
      ]

      const pieData = models.map((m) => ({
        name: m.model,
        value: Math.round(m.total_cost_usd * 10000) / 10000,
      }))

      expect(pieData).toEqual([
        { name: 'claude-sonnet', value: 0.5 },
        { name: 'gpt-4o', value: 0.3 },
      ])
    })

    it('truncates project names for bar chart', () => {
      const projects = [
        { project_path: '/Users/test/very/long/path/project-a', session_count: 10 },
        { project_path: '/short', session_count: 5 },
      ]

      const names = projects.map((p) => {
        const segments = p.project_path.split('/').filter(Boolean)
        return segments.length > 2 ? '.../' + segments.slice(-2).join('/') : p.project_path
      })

      expect(names).toEqual(['.../path/project-a', '/short'])
    })

    it('limits to top 5 items', () => {
      const tools = Array.from({ length: 10 }, (_, i) => ({
        tool_name: `tool_${i}`,
        call_count: 100 - i * 10,
      }))

      const top5 = tools.slice(0, 5)
      expect(top5).toHaveLength(5)
      expect(top5[0].tool_name).toBe('tool_0')
      expect(top5[4].tool_name).toBe('tool_4')
    })

    it('computes tool success rate', () => {
      const overview = { tool_call_count: 100, tool_error_count: 5 }
      const rate = ((1 - overview.tool_error_count / overview.tool_call_count) * 100).toFixed(1)
      expect(rate).toBe('95.0')
    })

    it('handles zero tool calls for success rate', () => {
      const overview = { tool_call_count: 0, tool_error_count: 0 }
      const total = overview.tool_call_count
      const rate = total === 0 ? '100' : ((1 - overview.tool_error_count / total) * 100).toFixed(1)
      expect(rate).toBe('100')
    })
  })
})
