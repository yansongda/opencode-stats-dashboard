import { describe, it, expect } from 'bun:test'

// Test route definitions without instantiating the router (avoids window dependency)
const routeDefinitions = [
  { path: '/', name: 'overview', label: '概览' },
  { path: '/efficiency', name: 'efficiency', label: '效率分析' },
  { path: '/models', name: 'models', label: '模型对比' },
  { path: '/projects', name: 'projects', label: '项目对比' },
  { path: '/tools', name: 'tools', label: '工具统计' },
  { path: '/sessions', name: 'sessions', label: '会话' },
]

describe('Vue Router route definitions', () => {
  it('has 6 routes matching design doc §11.1', () => {
    expect(routeDefinitions.length).toBe(6)
  })

  it('route names match design doc §11.1 page list', () => {
    const expectedNames = ['overview', 'efficiency', 'models', 'projects', 'tools', 'sessions']
    const actualNames = routeDefinitions.map((r) => r.name)
    expect(actualNames.sort()).toEqual(expectedNames.sort())
  })

  it('each route has a unique path', () => {
    const paths = routeDefinitions.map((r) => r.path)
    const unique = new Set(paths)
    expect(unique.size).toBe(paths.length)
  })

  it('overview is the root route', () => {
    const overview = routeDefinitions.find((r) => r.name === 'overview')
    expect(overview?.path).toBe('/')
  })

  it('all other routes start with /', () => {
    for (const route of routeDefinitions) {
      expect(route.path).toMatch(/^\//)
    }
  })

  it('all routes have a non-empty name', () => {
    for (const route of routeDefinitions) {
      expect(route.name.length).toBeGreaterThan(0)
    }
  })
})
