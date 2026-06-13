import { describe, expect, it } from "bun:test";
import { queryPrimaryModelByKey, queryPrimaryModelByProjectWhere, queryPrimaryModelForSession } from "../../../../src/api/dashboard/components/primary-model";
import { createTestDb } from "../../../helpers/db";
import { seedDashboardData } from "../../../helpers/dashboard-seed";

describe("primary model query helpers", () => {
  it("returns primary model by session id", () => {
    const db = createTestDb();
    seedDashboardData(db);

    expect(queryPrimaryModelByKey(db, "session_id", ["ses_1", "ses_2"])).toEqual(
      new Map([
        ["ses_1", "openai/gpt-4"],
        ["ses_2", "anthropic/claude"],
      ]),
    );
  });

  it("returns the primary model for one session", () => {
    const db = createTestDb();
    seedDashboardData(db);

    expect(queryPrimaryModelForSession(db, "ses_1")).toBe("openai/gpt-4");
    expect(queryPrimaryModelForSession(db, "missing")).toBeNull();
  });

  it("normalizes project keys while folding model totals", () => {
    const db = createTestDb();
    seedDashboardData(db);

    const result = queryPrimaryModelByProjectWhere(db, "", [], (value) => value ?? "(no project)");

    expect(result.get("/repo-a")).toBe("openai/gpt-4");
    expect(result.get("/repo-b")).toBe("anthropic/claude");
  });
});
