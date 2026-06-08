/**
 * SQLite schema migrations and PRAGMA configuration.
 *
 * Tables created:
 *   - events              (Event Store, §3.1)
 *   - sessions            (§4.1)
 *   - messages            (§4.2)
 *   - tool_calls          (§4.3)
 *
 * `schema_migrations` tracks applied versions for idempotent runs.
 */

import type { Database } from "bun:sqlite";
import * as m001 from "@db/migrations/001_initial";

/** All migration modules in order. */
const MIGRATIONS = [m001];

/** Latest schema version — derived from migration list length. */
export const CURRENT_VERSION = MIGRATIONS.length;

/**
 * Configure PRAGMAs for optimal performance.
 *
 * - journal_mode = WAL   (concurrent readers + single writer)
 * - synchronous  = NORMAL (good durability with WAL)
 */
export function configurePragmas(db: Database): void {
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA synchronous = NORMAL");
}

/**
 * Return the highest applied migration version, or 0 if none.
 */
function currentVersion(db: Database): number {
  const exists = db
    .query(
      "SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name='schema_migrations'",
    )
    .get() as { cnt: number } | null;

  if (!exists || exists.cnt === 0) {
    return 0;
  }

  const row = db
    .query("SELECT COALESCE(MAX(version), 0) as v FROM schema_migrations")
    .get() as { v: number } | null;

  return row?.v ?? 0;
}

/**
 * Ensure the schema_migrations tracking table exists.
 */
function ensureMigrationsTable(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

/**
 * Run all pending migrations inside a single transaction.
 *
 * Idempotent — safe to call multiple times.
 *
 * @returns Number of migrations applied (0 if already up-to-date).
 */
export function runMigrations(db: Database): number {
  ensureMigrationsTable(db);
  const current = currentVersion(db);
  let appliedCount = 0;

  const tx = db.transaction(() => {
    for (let i = 0; i < MIGRATIONS.length; i++) {
      const migration = MIGRATIONS[i];
      if (!migration) continue;
      const version = i + 1;
      if (version <= current) {
        continue;
      }
      migration.up(db);
      db.run("INSERT INTO schema_migrations (version) VALUES (?)", [version]);
      appliedCount++;
    }
  });

  tx();
  return appliedCount;
}
