import { describe, expect, it } from "bun:test";
import { buildWhereConditions, parseOptionalString } from "../../../../src/api/dashboard/helpers/where";

describe("where dashboard helpers", () => {
  it("parses optional strings", () => {
    expect(parseOptionalString(undefined)).toBeUndefined();
    expect(parseOptionalString("")).toBeUndefined();
    expect(parseOptionalString("  ")).toBe("  ");
    expect(parseOptionalString("project")).toBe("project");
  });

  it("returns an empty clause when all conditions are inactive", () => {
    expect(buildWhereConditions([["project_path = ?", undefined]])).toEqual({ clause: "", params: [] });
  });

  it("joins active conditions and preserves parameter order", () => {
    expect(
      buildWhereConditions([
        ["project_path = ?", "/repo"],
        ["created_at_ms >= ?", 10],
        ["model = ?", undefined],
        ["created_at_ms <= ?", 20],
      ]),
    ).toEqual({
      clause: " AND project_path = ? AND created_at_ms >= ? AND created_at_ms <= ?",
      params: ["/repo", 10, 20],
    });
  });
});
