import { describe, expect, it } from "bun:test";
import { safeDivide, safeRate, toNum } from "../../../../src/api/dashboard/helpers/numeric";

describe("numeric dashboard helpers", () => {
  describe("safeDivide", () => {
    it("returns quotient without rounding by default", () => {
      expect(safeDivide(10, 4)).toBe(2.5);
    });

    it("rounds to requested precision", () => {
      expect(safeDivide(10, 3, 2)).toBe(3.33);
    });

    it("returns null for invalid operands or zero denominator", () => {
      expect(safeDivide(null, 2)).toBeNull();
      expect(safeDivide(2, undefined)).toBeNull();
      expect(safeDivide(Number.NaN, 2)).toBeNull();
      expect(safeDivide(2, 0)).toBeNull();
    });
  });

  describe("safeRate", () => {
    it("returns numerator divided by denominator", () => {
      expect(safeRate(2, 5)).toBe(0.4);
    });

    it("clamps rates to the inclusive 0..1 range", () => {
      expect(safeRate(10, 5)).toBe(1);
      expect(safeRate(-1, 5)).toBe(0);
    });

    it("returns null for invalid operands or zero denominator", () => {
      expect(safeRate(undefined, 5)).toBeNull();
      expect(safeRate(1, Number.POSITIVE_INFINITY)).toBeNull();
      expect(safeRate(1, 0)).toBeNull();
    });
  });

  describe("toNum", () => {
    it("converts finite numeric values", () => {
      expect(toNum("42")).toBe(42);
      expect(toNum(3.5)).toBe(3.5);
    });

    it("uses fallback for nullish and non-finite values", () => {
      expect(toNum(null)).toBe(0);
      expect(toNum(undefined, 7)).toBe(7);
      expect(toNum("not-a-number", 9)).toBe(9);
      expect(toNum(Number.POSITIVE_INFINITY, 11)).toBe(11);
    });
  });
});
