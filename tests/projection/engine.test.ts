import { describe, expect, it } from "bun:test";
import type { StatsEvent } from "../../src/types/events";
import type { ProjectionHandler, TransactionContext } from "../../src/types/projections";
import { ProjectionEngine } from "../../src/projection/engine";
import { createTestDb } from "../helpers/db";
import { sessionCreated, sessionUpdated } from "../helpers/stats-events";

describe("ProjectionEngine", () => {
  it("registers handlers and rejects duplicate names", () => {
    const engine = new ProjectionEngine(createTestDb());
    const handler: ProjectionHandler = { handles: ["session.created"], handle: () => {} };

    engine.registerHandler("sessions", handler);

    expect(engine.hasHandler("sessions")).toBe(true);
    expect(engine.getHandlerNames()).toEqual(["sessions"]);
    expect(() => engine.registerHandler("sessions", handler)).toThrow('Handler "sessions" is already registered');
  });

  it("routes events only to matching handlers", () => {
    const engine = new ProjectionEngine(createTestDb());
    const handled: StatsEvent[] = [];
    engine.registerHandler("sessions", {
      handles: ["session.created"],
      handle: (event: StatsEvent) => handled.push(event),
    });

    engine.processEvent(sessionCreated());
    engine.processEvent(sessionUpdated());

    expect(handled.map((event) => event.event_type)).toEqual(["session.created"]);
  });

  it("processes batches in one transaction and rolls back on failure", () => {
    const db = createTestDb();
    const engine = new ProjectionEngine(db);
    engine.registerHandler("writer", {
      handles: ["session.created", "session.updated"],
      handle: (event: StatsEvent, txn: TransactionContext) => {
        if (event.event_type === "session.updated") {
          throw new Error("rollback");
        }
        txn.run("INSERT INTO sessions (session_id, project_path, title, first_event_at_ms, last_event_at_ms) VALUES (?, ?, ?, ?, ?)", [
          event.session_id,
          "/repo",
          event.event_type,
          event.created_at_ms,
          event.created_at_ms,
        ]);
      },
    });

    expect(() => engine.processEvents([sessionCreated({ session_id: "ses_tx" }), sessionUpdated({ session_id: "ses_tx" })])).toThrow("rollback");
    expect(db.query("SELECT COUNT(*) AS count FROM sessions WHERE session_id = 'ses_tx'").get()).toEqual({ count: 0 });
  });
});
