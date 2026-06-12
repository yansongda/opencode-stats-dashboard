import { Database } from "bun:sqlite";
import { runMigrations } from "../../src/db/schema";

export function createTestDb(): Database {
  const db = new Database(":memory:");
  runMigrations(db);
  return db;
}

export function listTables(db: Database): string[] {
  return db
    .query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => (row as { name: string }).name);
}
