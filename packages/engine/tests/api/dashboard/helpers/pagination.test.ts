import { describe, expect, it } from "bun:test";
import { parsePagination } from "../../../../src/api/dashboard/helpers/pagination";

describe("parsePagination", () => {
  it("returns defaults when query params are absent", () => {
    expect(parsePagination(undefined, undefined)).toEqual({ limit: 20, offset: 0 });
  });

  it("parses valid integer-like values", () => {
    expect(parsePagination("50", "10")).toEqual({ limit: 50, offset: 10 });
  });

  it("floors decimal values", () => {
    expect(parsePagination("10.9", "3.8")).toEqual({ limit: 10, offset: 3 });
  });

  it("clamps limit to 500", () => {
    expect(parsePagination("999", "0")).toEqual({ limit: 500, offset: 0 });
  });

  it("falls back for invalid limit and offset", () => {
    expect(parsePagination("0", "-1")).toEqual({ limit: 20, offset: 0 });
    expect(parsePagination("NaN", "Infinity")).toEqual({ limit: 20, offset: 0 });
  });
});
