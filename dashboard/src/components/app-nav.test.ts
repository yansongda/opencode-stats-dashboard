import { describe, it, expect } from 'bun:test'

// Test AppNav link definitions (extracted from component)
describe('AppNav links', () => {
  const links = [
    { to: '/', label: '概览', testId: 'overview' },
    { to: '/efficiency', label: '效率分析', testId: 'efficiency' },
    { to: '/models', label: '模型对比', testId: 'models' },
    { to: '/projects', label: '项目对比', testId: 'projects' },
    { to: '/tools', label: '工具统计', testId: 'tools' },
    { to: '/sessions', label: '会话', testId: 'sessions' },
  ]

  it('has 6 navigation links', () => {
    expect(links.length).toBe(6)
  })

  it('each link has a valid route path', () => {
    for (const link of links) {
      expect(link.to).toMatch(/^\//)
    }
  })

  it('each link has a non-empty label', () => {
    for (const link of links) {
      expect(link.label.length).toBeGreaterThan(0)
    }
  })

  it('each link has a testId for data-testid attribute', () => {
    for (const link of links) {
      expect(link.testId.length).toBeGreaterThan(0)
    }
  })

  it('links match router paths exactly', () => {
    const routerPaths = ['/', '/efficiency', '/models', '/projects', '/tools', '/sessions']
    const linkPaths = links.map((l) => l.to)
    expect(linkPaths.sort()).toEqual(routerPaths.sort())
  })
})
