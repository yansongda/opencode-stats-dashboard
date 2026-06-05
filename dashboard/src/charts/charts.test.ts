import { describe, it, expect } from 'bun:test'
import { computed, ref } from 'vue'

// ── Chart Option Helpers ───────────────────────────────────────────
// We test the option computation logic directly since bun:test has no DOM.
// Each chart component's computed option follows the same pattern.

function buildLineOption(
  xData: string[],
  series: Array<{ name: string; data: number[]; color?: string }>,
  opts: { showArea?: boolean; smooth?: boolean } = {},
) {
  return {
    tooltip: { trigger: 'axis' },
    legend: { show: series.length > 1, top: 0, textStyle: { fontSize: 12 } },
    grid: { left: '3%', right: '4%', bottom: '3%', top: series.length > 1 ? 40 : 20, containLabel: true },
    xAxis: { type: 'category' as const, data: xData, boundaryGap: false, axisLabel: { fontSize: 11 } },
    yAxis: { type: 'value' as const, axisLabel: { fontSize: 11 } },
    series: series.map((s) => ({
      name: s.name,
      type: 'line' as const,
      data: s.data,
      smooth: opts.smooth ?? true,
      lineStyle: { color: s.color, width: 2 },
      itemStyle: { color: s.color },
      areaStyle: opts.showArea ? { color: s.color, opacity: 0.15 } : undefined,
    })),
  }
}

function buildBarOption(
  xData: string[],
  series: Array<{ name: string; data: number[]; color?: string }>,
  opts: { horizontal?: boolean; stacked?: boolean } = {},
) {
  const categoryAxis = { type: 'category' as const, data: xData, axisLabel: { fontSize: 11, rotate: xData.length > 8 ? 45 : 0 } }
  const valueAxis = { type: 'value' as const, axisLabel: { fontSize: 11 } }
  const xAxis = opts.horizontal ? valueAxis : categoryAxis
  const yAxis = opts.horizontal ? categoryAxis : valueAxis

  return {
    tooltip: { trigger: 'axis' },
    legend: { show: series.length > 1, top: 0, textStyle: { fontSize: 12 } },
    grid: { left: '3%', right: '4%', bottom: '3%', top: series.length > 1 ? 40 : 20, containLabel: true },
    xAxis,
    yAxis,
    series: series.map((s) => ({
      name: s.name,
      type: 'bar' as const,
      data: s.data,
      stack: opts.stacked ? 'total' : undefined,
      barMaxWidth: 40,
      itemStyle: { color: s.color, borderRadius: opts.horizontal ? [0, 4, 4, 0] : [0, 0, 0, 0] },
    })),
  }
}

function buildPieOption(
  data: Array<{ name: string; value: number }>,
  opts: { donut?: boolean; innerRadius?: number } = {},
) {
  const radius = opts.donut
    ? [`${Math.round((opts.innerRadius ?? 0.55) * 100)}%`, '70%']
    : ['0%', '70%']

  return {
    tooltip: { trigger: 'item' },
    legend: { orient: 'vertical' as const, right: '5%', top: 'center', textStyle: { fontSize: 12 } },
    series: [
      {
        type: 'pie' as const,
        radius,
        center: ['40%', '50%'],
        data,
        label: { show: true, fontSize: 11 },
        emphasis: { itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: 'rgba(0, 0, 0, 0.3)' } },
      },
    ],
  }
}

function buildHeatmapOption(
  data: Array<{ day: number; hour: number; value: number }>,
  dayLabels: string[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
) {
  const hours = Array.from({ length: 24 }, (_, i) => `${i}:00`)
  const maxVal = Math.max(...data.map((d) => d.value), 1)
  const heatData = data.map((d) => [d.hour, d.day, d.value])

  return {
    tooltip: { position: 'top' },
    grid: { left: '10%', right: '15%', bottom: '15%', top: '10%', containLabel: false },
    xAxis: { type: 'category' as const, data: hours, splitArea: { show: true }, axisLabel: { fontSize: 10, interval: 2 } },
    yAxis: { type: 'category' as const, data: dayLabels, splitArea: { show: true }, axisLabel: { fontSize: 11 } },
    visualMap: { min: 0, max: maxVal, calculable: true, orient: 'vertical' as const, right: '2%', top: 'center', inRange: { color: ['#ebedf0', '#40c463'] }, textStyle: { fontSize: 11 } },
    series: [{ type: 'heatmap' as const, data: heatData, label: { show: false }, emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0, 0, 0, 0.5)' } } }],
  }
}

function buildScatterOption(
  data: Array<{ name: string; x: number; y: number; size?: number }>,
) {
  const scatterData = data.map((d) => ({
    name: d.name,
    value: [d.x, d.y],
    symbolSize: d.size ?? 12,
  }))

  return {
    tooltip: { trigger: 'item' },
    grid: { left: '3%', right: '4%', bottom: '3%', top: 20, containLabel: true },
    xAxis: { type: 'value' as const, axisLabel: { fontSize: 11 } },
    yAxis: { type: 'value' as const, axisLabel: { fontSize: 11 } },
    series: [{ type: 'scatter' as const, data: scatterData, itemStyle: {}, emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0, 0, 0, 0.3)' } } }],
  }
}

// ── Tests ──────────────────────────────────────────────────────────

describe('Chart Option Builders', () => {
  describe('LineChart options', () => {
    it('builds single series line option', () => {
      const opt = buildLineOption(['Mon', 'Tue', 'Wed'], [{ name: 'Tokens', data: [100, 200, 150] }])
      expect(opt.series).toHaveLength(1)
      expect(opt.series[0].type).toBe('line')
      expect(opt.xAxis.data).toEqual(['Mon', 'Tue', 'Wed'])
      expect(opt.legend.show).toBe(false)
    })

    it('builds multi-series with legend', () => {
      const opt = buildLineOption(['Mon', 'Tue'], [
        { name: 'Input', data: [100, 200], color: '#5470c6' },
        { name: 'Output', data: [50, 100], color: '#91cc75' },
      ])
      expect(opt.series).toHaveLength(2)
      expect(opt.legend.show).toBe(true)
      expect(opt.series[0].lineStyle.color).toBe('#5470c6')
    })

    it('disables smooth when smooth=false', () => {
      const opt = buildLineOption(['A', 'B'], [{ name: 'X', data: [1, 2] }], { smooth: false })
      expect(opt.series[0].smooth).toBe(false)
    })

    it('enables area style when showArea=true', () => {
      const opt = buildLineOption(['A', 'B'], [{ name: 'X', data: [1, 2] }], { showArea: true })
      expect(opt.series[0].areaStyle).toBeDefined()
      expect(opt.series[0].areaStyle!.opacity).toBe(0.15)
    })

    it('has no area style by default', () => {
      const opt = buildLineOption(['A'], [{ name: 'X', data: [1] }])
      expect(opt.series[0].areaStyle).toBeUndefined()
    })
  })

  describe('BarChart options', () => {
    it('builds vertical bar option', () => {
      const opt = buildBarOption(['bash', 'read_file'], [{ name: 'Calls', data: [100, 50] }])
      expect(opt.series[0].type).toBe('bar')
      expect(opt.xAxis.type).toBe('category')
      expect(opt.yAxis.type).toBe('value')
    })

    it('builds horizontal bar option', () => {
      const opt = buildBarOption(['bash', 'read_file'], [{ name: 'Calls', data: [100, 50] }], { horizontal: true })
      expect(opt.xAxis.type).toBe('value')
      expect(opt.yAxis.type).toBe('category')
    })

    it('builds stacked bar option', () => {
      const opt = buildBarOption(['A', 'B'], [
        { name: 'Input', data: [10, 20] },
        { name: 'Output', data: [5, 10] },
      ], { stacked: true })
      expect(opt.series[0].stack).toBe('total')
      expect(opt.series[1].stack).toBe('total')
    })

    it('rotates labels when many categories', () => {
      const labels = Array.from({ length: 10 }, (_, i) => `tool_${i}`)
      const opt = buildBarOption(labels, [{ name: 'X', data: Array(10).fill(1) }])
      const axisLabel = opt.xAxis.axisLabel as { fontSize: number; rotate: number }
      expect(axisLabel.rotate).toBe(45)
    })

    it('does not rotate labels when few categories', () => {
      const opt = buildBarOption(['A', 'B', 'C'], [{ name: 'X', data: [1, 2, 3] }])
      const axisLabel = opt.xAxis.axisLabel as { fontSize: number; rotate: number }
      expect(axisLabel.rotate).toBe(0)
    })
  })

  describe('PieChart options', () => {
    it('builds pie option', () => {
      const opt = buildPieOption([
        { name: 'claude-sonnet', value: 85 },
        { name: 'gpt-4o', value: 43 },
      ])
      expect(opt.series[0].type).toBe('pie')
      expect(opt.series[0].data).toHaveLength(2)
    })

    it('builds donut option with inner radius', () => {
      const opt = buildPieOption([{ name: 'A', value: 1 }], { donut: true, innerRadius: 0.55 })
      expect(opt.series[0].radius).toEqual(['55%', '70%'])
    })

    it('uses full radius when not donut', () => {
      const opt = buildPieOption([{ name: 'A', value: 1 }])
      expect(opt.series[0].radius).toEqual(['0%', '70%'])
    })

    it('shows legend vertically', () => {
      const opt = buildPieOption([{ name: 'A', value: 1 }])
      expect(opt.legend.orient).toBe('vertical')
    })
  })

  describe('HeatmapChart options', () => {
    it('builds heatmap with correct data format', () => {
      const data = [
        { day: 0, hour: 9, value: 5 },
        { day: 0, hour: 10, value: 10 },
        { day: 1, hour: 14, value: 3 },
      ]
      const opt = buildHeatmapOption(data)
      expect(opt.series[0].type).toBe('heatmap')
      expect(opt.series[0].data).toEqual([
        [9, 0, 5],
        [10, 0, 10],
        [14, 1, 3],
      ])
    })

    it('computes correct visualMap max', () => {
      const data = [{ day: 0, hour: 0, value: 42 }]
      const opt = buildHeatmapOption(data)
      expect(opt.visualMap.max).toBe(42)
    })

    it('defaults max to 1 when no data', () => {
      const opt = buildHeatmapOption([])
      expect(opt.visualMap.max).toBe(1)
    })

    it('uses 24 hours on x-axis', () => {
      const opt = buildHeatmapOption([])
      expect(opt.xAxis.data).toHaveLength(24)
      expect(opt.xAxis.data[0]).toBe('0:00')
      expect(opt.xAxis.data[23]).toBe('23:00')
    })

    it('uses custom day labels', () => {
      const labels = ['一', '二', '三', '四', '五', '六', '日']
      const opt = buildHeatmapOption([], labels)
      expect(opt.yAxis.data).toEqual(labels)
    })
  })

  describe('ScatterChart options', () => {
    it('builds scatter option', () => {
      const data = [
        { name: 'claude-sonnet', x: 100, y: 0.05 },
        { name: 'gpt-4o', x: 50, y: 0.03 },
      ]
      const opt = buildScatterOption(data)
      expect(opt.series[0].type).toBe('scatter')
      expect(opt.series[0].data).toHaveLength(2)
    })

    it('converts x,y to value array', () => {
      const data = [{ name: 'A', x: 10, y: 20, size: 15 }]
      const opt = buildScatterOption(data)
      expect(opt.series[0].data[0].value).toEqual([10, 20])
      expect(opt.series[0].data[0].symbolSize).toBe(15)
    })

    it('defaults symbolSize to 12', () => {
      const data = [{ name: 'A', x: 1, y: 2 }]
      const opt = buildScatterOption(data)
      expect(opt.series[0].data[0].symbolSize).toBe(12)
    })
  })

  describe('Data updates', () => {
    it('reacts to data changes via computed', () => {
      const xData = ref(['Mon', 'Tue'])
      const seriesData = ref([100, 200])

      const option = computed(() => buildLineOption(xData.value, [{ name: 'Test', data: seriesData.value }]))
      expect(option.value.xAxis.data).toEqual(['Mon', 'Tue'])
      expect(option.value.series[0].data).toEqual([100, 200])

      // Update data
      xData.value = ['Wed', 'Thu', 'Fri']
      seriesData.value = [300, 400, 500]

      expect(option.value.xAxis.data).toEqual(['Wed', 'Thu', 'Fri'])
      expect(option.value.series[0].data).toEqual([300, 400, 500])
    })
  })
})
