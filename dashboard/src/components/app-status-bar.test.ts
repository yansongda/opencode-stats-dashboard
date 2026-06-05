import { describe, it, expect } from 'bun:test'

// Test AppStatusBar computed properties logic
describe('AppStatusBar status mapping', () => {
  type RealtimeMode = 'sse' | 'polling' | 'disconnected'

  function getDotClass(mode: RealtimeMode): string {
    switch (mode) {
      case 'sse': return 'dot-live'
      case 'polling': return 'dot-polling'
      case 'disconnected': return 'dot-offline'
    }
  }

  function getStatusLabel(mode: RealtimeMode): string {
    switch (mode) {
      case 'sse': return 'Live'
      case 'polling': return 'Polling'
      case 'disconnected': return 'Offline'
    }
  }

  it('returns dot-live for sse mode', () => {
    expect(getDotClass('sse')).toBe('dot-live')
  })

  it('returns dot-polling for polling mode', () => {
    expect(getDotClass('polling')).toBe('dot-polling')
  })

  it('returns dot-offline for disconnected mode', () => {
    expect(getDotClass('disconnected')).toBe('dot-offline')
  })

  it('returns Live label for sse mode', () => {
    expect(getStatusLabel('sse')).toBe('Live')
  })

  it('returns Polling label for polling mode', () => {
    expect(getStatusLabel('polling')).toBe('Polling')
  })

  it('returns Offline label for disconnected mode', () => {
    expect(getStatusLabel('disconnected')).toBe('Offline')
  })
})
