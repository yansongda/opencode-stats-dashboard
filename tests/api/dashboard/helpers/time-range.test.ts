import { afterEach, describe, expect, it } from "bun:test";
import { parseTimeRange } from "../../../../src/api/dashboard/helpers/time-range";

const originalDateNow = Date.now;

afterEach(() => {
  Date.now = originalDateNow;
});

describe("parseTimeRange", () => {
  it("defaults to start zero and current time", () => {
    Date.now = () => 1_700_000_000_000;

    expect(parseTimeRange(undefined, undefined)).toEqual({
      ok: true,
      start: 0,
      end: 1_700_000_000_000,
    });
  });

  it("parses and floors valid boundaries", () => {
    expect(parseTimeRange("10.9", "20.2")).toEqual({ ok: true, start: 10, end: 20 });
  });

  it("uses current time when end is absent", () => {
    Date.now = () => 1234;

    expect(parseTimeRange("10", undefined)).toEqual({ ok: true, start: 10, end: 1234 });
  });

  it("rejects invalid start and end values", () => {
    expect(parseTimeRange("-1", "10")).toEqual({
      ok: false,
      error: "start must be a non-negative integer (ms)",
      field: "start",
    });
    expect(parseTimeRange("1", "Infinity")).toEqual({
      ok: false,
      error: "end must be a non-negative integer (ms)",
      field: "end",
    });
  });

  it("rejects start after end", () => {
    expect(parseTimeRange("20", "10")).toEqual({
      ok: false,
      error: "start (20) must be ≤ end (10)",
      field: "start",
    });
  });
});
