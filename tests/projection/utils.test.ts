import { describe, expect, it } from "bun:test";
import { totalTokens } from "../../src/projection/utils";

describe("totalTokens", () => {
  it("sums all token buckets", () => {
    expect(
      totalTokens({
        input: 10,
        output: 20,
        reasoning: 3,
        cache: { read: 4, write: 5 },
      }),
    ).toBe(42);
  });

  it("returns zero for an all-zero token breakdown", () => {
    expect(totalTokens({ input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } })).toBe(0);
  });
});
