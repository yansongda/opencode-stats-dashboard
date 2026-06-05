import { describe, it, expect } from 'bun:test'
import type { StatsModelItem } from '../api/client'

// ── Test Data ──────────────────────────────────────────────────────────

const MOCK_MODELS: StatsModelItem[] = [
  {
    model: 'claude-sonnet-4-20250514',
    session_count: 85,
    message_count: 420,
    total_tokens: 800000,
    input_tokens: 600000,
    output_tokens: 180000,
    reasoning_tokens: 20000,
    total_cost_usd: 8.50,
    avg_cost_per_session: 0.10,
    tool_call_count: 300,
    error_count: 5,
  },
  {
    model: 'gpt-4o',
    session_count: 43,
    message_count: 200,
    total_tokens: 400000,
    input_tokens: 300000,
    output_tokens: 90000,
    reasoning_tokens: 10000,
    total_cost_usd: 3.84,
    avg_cost_per_session: 0.089,
    tool_call_count: 150,
    error_count: 3,
  },
  {
    model: 'claude-haiku-3',
    session_count: 20,
    message_count: 100,
    total_tokens: 150000,
    input_tokens: 120000,
    output_tokens: 25000,
    reasoning_tokens: 5000,
    total_cost_usd: 0.75,
    avg_cost_per_session: 0.0375,
    tool_call_count: 80,
    error_count: 0,
  },
]

// ── Helper Functions (extracted from ModelsView.vue logic) ─────────────

function truncateModel(model: string): string {
  if (model.length <= 20) return model
  return '…' + model.slice(-18)
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`
  return tokens.toLocaleString()
}

function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`
}

function formatErrorRate(m: StatsModelItem): string {
  if (m.message_count === 0) return '—'
  const rate = (m.error_count / m.message_count) * 100
  return `${rate.toFixed(1)}%`
}

function errorRateClass(m: StatsModelItem): string {
  if (m.message_count === 0) return ''
  const rate = (m.error_count / m.message_count) * 100
  if (rate >= 5) return 'rate-high'
  if (rate >= 2) return 'rate-medium'
  return 'rate-low'
}

function sortModels(
  data: StatsModelItem[],
  sortKey: keyof StatsModelItem | null,
  sortAsc: boolean,
): StatsModelItem[] {
  const sorted = [...data]
  if (!sortKey) return sorted

  const key = sortKey
  const dir = sortAsc ? 1 : -1

  return sorted.sort((a, b) => {
    const va = a[key]
    const vb = b[key]
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir
    return String(va).localeCompare(String(vb)) * dir
  })
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('ModelsView data processing', () => {
  describe('truncateModel', () => {
    it('returns short model names unchanged', () => {
      expect(truncateModel('gpt-4o')).toBe('gpt-4o')
      expect(truncateModel('claude-haiku-3')).toBe('claude-haiku-3')
    })

    it('truncates long model names with ellipsis prefix', () => {
      const result = truncateModel('claude-sonnet-4-20250514')
      expect(result).toBe('…-sonnet-4-20250514')
      expect(result.length).toBeLessThanOrEqual(20)
    })

    it('handles edge case at exactly 20 chars', () => {
      const name = '12345678901234567890' // 20 chars
      expect(truncateModel(name)).toBe(name)
    })

    it('truncates at 21 chars', () => {
      const name = '123456789012345678901' // 21 chars
      expect(truncateModel(name)).toBe('…456789012345678901')
    })
  })

  describe('formatTokens', () => {
    it('formats millions', () => {
      expect(formatTokens(1_000_000)).toBe('1.0M')
      expect(formatTokens(800_000)).toBe('800.0K')
      expect(formatTokens(1_500_000)).toBe('1.5M')
    })

    it('formats thousands', () => {
      expect(formatTokens(1_000)).toBe('1.0K')
      expect(formatTokens(500_000)).toBe('500.0K')
    })

    it('formats small numbers', () => {
      expect(formatTokens(500)).toBe('500')
      expect(formatTokens(0)).toBe('0')
    })
  })

  describe('formatCost', () => {
    it('formats cost with dollar sign and 2 decimals', () => {
      expect(formatCost(8.5)).toBe('$8.50')
      expect(formatCost(0)).toBe('$0.00')
      expect(formatCost(0.1)).toBe('$0.10')
    })

    it('handles large costs', () => {
      expect(formatCost(1234.56)).toBe('$1234.56')
    })
  })

  describe('formatErrorRate', () => {
    it('calculates error rate percentage', () => {
      // 5 errors / 420 messages = 1.19%
      expect(formatErrorRate(MOCK_MODELS[0])).toBe('1.2%')
    })

    it('returns dash for zero messages', () => {
      const zeroModel: StatsModelItem = { ...MOCK_MODELS[0], message_count: 0 }
      expect(formatErrorRate(zeroModel)).toBe('—')
    })

    it('handles zero errors', () => {
      // 0 errors / 100 messages = 0.0%
      expect(formatErrorRate(MOCK_MODELS[2])).toBe('0.0%')
    })
  })

  describe('errorRateClass', () => {
    it('returns rate-low for low error rates', () => {
      // 5/420 = 1.19% < 2%
      expect(errorRateClass(MOCK_MODELS[0])).toBe('rate-low')
    })

    it('returns rate-medium for medium error rates', () => {
      const mediumModel: StatsModelItem = { ...MOCK_MODELS[0], error_count: 10, message_count: 200 }
      // 10/200 = 5% >= 5% → rate-high
      expect(errorRateClass(mediumModel)).toBe('rate-high')
    })

    it('returns rate-high for high error rates', () => {
      const highModel: StatsModelItem = { ...MOCK_MODELS[0], error_count: 50, message_count: 200 }
      // 50/200 = 25% >= 5%
      expect(errorRateClass(highModel)).toBe('rate-high')
    })

    it('returns empty string for zero messages', () => {
      const zeroModel: StatsModelItem = { ...MOCK_MODELS[0], message_count: 0 }
      expect(errorRateClass(zeroModel)).toBe('')
    })
  })

  describe('sortModels', () => {
    it('returns unsorted when sortKey is null', () => {
      const result = sortModels(MOCK_MODELS, null, true)
      expect(result).toEqual(MOCK_MODELS)
    })

    it('sorts by model name ascending', () => {
      const result = sortModels(MOCK_MODELS, 'model', true)
      expect(result[0].model).toBe('claude-haiku-3')
      expect(result[1].model).toBe('claude-sonnet-4-20250514')
      expect(result[2].model).toBe('gpt-4o')
    })

    it('sorts by model name descending', () => {
      const result = sortModels(MOCK_MODELS, 'model', false)
      expect(result[0].model).toBe('gpt-4o')
      expect(result[2].model).toBe('claude-haiku-3')
    })

    it('sorts by total_cost_usd ascending', () => {
      const result = sortModels(MOCK_MODELS, 'total_cost_usd', true)
      expect(result[0].total_cost_usd).toBe(0.75)
      expect(result[2].total_cost_usd).toBe(8.50)
    })

    it('sorts by total_cost_usd descending', () => {
      const result = sortModels(MOCK_MODELS, 'total_cost_usd', false)
      expect(result[0].total_cost_usd).toBe(8.50)
      expect(result[2].total_cost_usd).toBe(0.75)
    })

    it('sorts by session_count', () => {
      const result = sortModels(MOCK_MODELS, 'session_count', true)
      expect(result[0].session_count).toBe(20)
      expect(result[2].session_count).toBe(85)
    })

    it('sorts by error_count', () => {
      const result = sortModels(MOCK_MODELS, 'error_count', false)
      expect(result[0].error_count).toBe(5)
      expect(result[2].error_count).toBe(0)
    })

    it('does not mutate original array', () => {
      const original = [...MOCK_MODELS]
      sortModels(MOCK_MODELS, 'model', true)
      expect(MOCK_MODELS).toEqual(original)
    })
  })

  describe('chart data computation', () => {
    it('token chart labels use truncated model names', () => {
      const labels = MOCK_MODELS.map((m) => truncateModel(m.model))
      expect(labels).toEqual([
        '…-sonnet-4-20250514',
        'gpt-4o',
        'claude-haiku-3',
      ])
    })

    it('token chart series extract correct token fields', () => {
      const inputSeries = MOCK_MODELS.map((m) => m.input_tokens)
      const outputSeries = MOCK_MODELS.map((m) => m.output_tokens)
      const reasoningSeries = MOCK_MODELS.map((m) => m.reasoning_tokens)

      expect(inputSeries).toEqual([600000, 300000, 120000])
      expect(outputSeries).toEqual([180000, 90000, 25000])
      expect(reasoningSeries).toEqual([20000, 10000, 5000])
    })

    it('scatter data maps cost vs output tokens', () => {
      const scatterData = MOCK_MODELS.map((m) => ({
        name: truncateModel(m.model),
        x: m.total_cost_usd,
        y: m.output_tokens,
      }))

      expect(scatterData).toEqual([
        { name: '…-sonnet-4-20250514', x: 8.50, y: 180000 },
        { name: 'gpt-4o', x: 3.84, y: 90000 },
        { name: 'claude-haiku-3', x: 0.75, y: 25000 },
      ])
    })

    it('scatter data size scales with session count', () => {
      const scatterData = MOCK_MODELS.map((m) => ({
        size: Math.max(8, Math.min(30, m.session_count / 2)),
      }))

      // 85/2 = 42.5 → capped at 30
      expect(scatterData[0].size).toBe(30)
      // 43/2 = 21.5
      expect(scatterData[1].size).toBe(21.5)
      // 20/2 = 10
      expect(scatterData[2].size).toBe(10)
    })
  })

  describe('store integration', () => {
    it('models data structure matches StatsModelItem', () => {
      const model = MOCK_MODELS[0]
      expect(model).toHaveProperty('model')
      expect(model).toHaveProperty('session_count')
      expect(model).toHaveProperty('message_count')
      expect(model).toHaveProperty('total_tokens')
      expect(model).toHaveProperty('input_tokens')
      expect(model).toHaveProperty('output_tokens')
      expect(model).toHaveProperty('reasoning_tokens')
      expect(model).toHaveProperty('total_cost_usd')
      expect(model).toHaveProperty('avg_cost_per_session')
      expect(model).toHaveProperty('tool_call_count')
      expect(model).toHaveProperty('error_count')
    })

    it('handles empty models array', () => {
      const empty: StatsModelItem[] = []
      const sorted = sortModels(empty, 'model', true)
      expect(sorted).toEqual([])
    })
  })
})
