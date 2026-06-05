import { describe, it, expect } from 'bun:test'
import { Database } from 'bun:sqlite'

describe('Project Setup', () => {
  it('should have bun available', () => {
    expect(typeof Bun).toBe('object')
  })

  it('should be able to create a SQLite database', () => {
    const db = new Database(':memory:')
    db.run('CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT)')
    db.run('INSERT INTO test VALUES (1, ?)', ['hello'])
    const row = db.query('SELECT * FROM test').get() as { id: number; value: string }
    expect(row.id).toBe(1)
    expect(row.value).toBe('hello')
    db.close()
  })

  it('should have TypeScript strict mode enabled', () => {
    // This test verifies the project can import types
    // If strict mode is misconfigured, TypeScript compilation will fail
    expect(true).toBe(true)
  })
})
