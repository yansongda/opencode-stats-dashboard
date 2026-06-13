import { describe, expect, it } from "bun:test";
import { ALLOWED_SORT_FIELDS, DEFAULT_SORT_FIELD, parseSortOrder } from "../../../../src/api/dashboard/helpers/sort";

describe("sort dashboard helpers", () => {
  it("exposes allow-lists and defaults for supported pages", () => {
    expect(ALLOWED_SORT_FIELDS.sessions).toContain("last_event_at_ms");
    expect(DEFAULT_SORT_FIELD.models).toBe("cost_usd");
  });

  it("accepts allowed sort field and order", () => {
    expect(parseSortOrder("models", "total_tokens", "asc")).toEqual({
      field: "total_tokens",
      order: "asc",
    });
  });

  it("falls back to page default for disallowed field", () => {
    expect(parseSortOrder("tools", "1; DROP TABLE tools", "desc")).toEqual({
      field: "call_count",
      order: "desc",
    });
  });

  it("falls back to desc for invalid order", () => {
    expect(parseSortOrder("projects", "project_path", "sideways")).toEqual({
      field: "project_path",
      order: "desc",
    });
  });

  it("uses rowid fallback for unknown pages without allow-list", () => {
    expect(parseSortOrder("unknown", "anything", "asc")).toEqual({ field: "rowid", order: "asc" });
  });
});
