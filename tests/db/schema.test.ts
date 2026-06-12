import { describe, expect, it } from "bun:test";
import { configurePragmas, CURRENT_VERSION, runMigrations } from "../../src/db/schema";
import { createTestDb, listTables } from "../helpers/db";

describe("database schema", () => {
  it("runs the initial migration and records the current version", () => {
    const db = createTestDb();

    expect(listTables(db)).toEqual([
      "events",
      "messages",
      "schema_migrations",
      "sessions",
      "tool_calls",
    ]);
    expect(db.query("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({
      version: CURRENT_VERSION,
    });
  });

  it("is idempotent when migrations are already applied", () => {
    const db = createTestDb();

    expect(runMigrations(db)).toBe(0);
  });

  it("configures supported pragmas without throwing", () => {
    const db = createTestDb();

    expect(() => configurePragmas(db)).not.toThrow();
  });

  it("creates expected indexes for query paths", () => {
    const db = createTestDb();
    const indexes = db
      .query("SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name);

    expect(indexes).toContain("idx_messages_session_created_at_ms");
    expect(indexes).toContain("idx_tool_calls_session_started_at_ms");
    expect(indexes).toContain("idx_events_error_created_at_ms");
  });
});
