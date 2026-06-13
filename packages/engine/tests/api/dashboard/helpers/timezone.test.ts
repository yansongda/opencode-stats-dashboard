import { describe, expect, it } from "bun:test";
import { getTzOffsetMinutes, parseTimezone } from "../../../../src/api/dashboard/helpers/timezone";

describe("timezone dashboard helpers", () => {
  describe("parseTimezone", () => {
    it("defaults missing and blank values to UTC", () => {
      expect(parseTimezone(undefined)).toEqual({ ok: true, tz: "UTC" });
      expect(parseTimezone("   ")).toEqual({ ok: true, tz: "UTC" });
    });

    it("trims and accepts valid IANA timezone names", () => {
      expect(parseTimezone(" Asia/Shanghai ")).toEqual({ ok: true, tz: "Asia/Shanghai" });
    });

    it("rejects too-long and invalid timezones", () => {
      expect(parseTimezone("A".repeat(51))).toEqual({ ok: false, error: "tz too long" });
      expect(parseTimezone("Not/AZone")).toEqual({ ok: false, error: "invalid timezone: Not/AZone" });
    });
  });

  describe("getTzOffsetMinutes", () => {
    it("returns zero for UTC", () => {
      expect(getTzOffsetMinutes("UTC", Date.UTC(2024, 0, 1, 0, 0, 0))).toBe(0);
    });

    it("returns fixed non-DST offset for Asia/Shanghai", () => {
      expect(getTzOffsetMinutes("Asia/Shanghai", Date.UTC(2024, 0, 1, 0, 0, 0))).toBe(480);
    });

    it("reflects DST-dependent New York offsets", () => {
      expect(getTzOffsetMinutes("America/New_York", Date.UTC(2024, 0, 15, 12, 0, 0))).toBe(-300);
      expect(getTzOffsetMinutes("America/New_York", Date.UTC(2024, 6, 15, 12, 0, 0))).toBe(-240);
    });
  });
});
