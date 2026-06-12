import { afterEach, describe, expect, it } from "bun:test";
import { createBaseEvent, defaultTokens, normalizeTokens } from "../../src/event/utils";

const originalDateNow = Date.now;
const originalRandomUUID = crypto.randomUUID;

afterEach(() => {
  Date.now = originalDateNow;
  crypto.randomUUID = originalRandomUUID;
});

describe("event utils", () => {
  describe("createBaseEvent", () => {
    it("uses crypto.randomUUID and Date.now", () => {
      Date.now = () => 1_700_000_000_000;
      crypto.randomUUID = () => "00000000-0000-4000-8000-000000000001";

      expect(createBaseEvent()).toEqual({
        event_id: "00000000-0000-4000-8000-000000000001",
        created_at_ms: 1_700_000_000_000,
      });
    });
  });

  describe("defaultTokens", () => {
    it("returns a zeroed token breakdown", () => {
      expect(defaultTokens()).toEqual({ input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } });
    });
  });

  describe("normalizeTokens", () => {
    it("returns undefined for non-object values", () => {
      expect(normalizeTokens(undefined)).toBeUndefined();
      expect(normalizeTokens(null)).toBeUndefined();
      expect(normalizeTokens("tokens")).toBeUndefined();
    });

    it("preserves numeric token fields", () => {
      expect(
        normalizeTokens({
          input: 1,
          output: 2,
          reasoning: 3,
          cache: { read: 4, write: 5 },
        }),
      ).toEqual({ input: 1, output: 2, reasoning: 3, cache: { read: 4, write: 5 } });
    });

    it("defaults missing or non-numeric token fields to zero", () => {
      expect(normalizeTokens({ input: "1", cache: { read: "2" } })).toEqual({
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      });
    });
  });
});
