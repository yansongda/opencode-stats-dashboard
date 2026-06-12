import { describe, expect, it } from "bun:test";
import { FORBIDDEN_METADATA_KEYS } from "../../src/types/events";

describe("FORBIDDEN_METADATA_KEYS", () => {
  it("lists privacy-sensitive metadata keys that must not be emitted", () => {
    expect([...FORBIDDEN_METADATA_KEYS]).toEqual([
      "tool_input",
      "tool_output",
      "message_body",
      "raw_input",
      "raw_output",
    ]);
  });
});
