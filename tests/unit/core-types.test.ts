import { describe, it, expect } from "vitest";
import type { Message, ToolDefinition } from "../../src/core/types.js";
import { DEFAULT_CONFIG } from "../../src/core/types.js";

describe("Core Types", () => {
  it("DEFAULT_CONFIG has sensible defaults", () => {
    expect(DEFAULT_CONFIG.name).toBe("Luna");
    expect(DEFAULT_CONFIG.maxTurns).toBe(50);
    expect(DEFAULT_CONFIG.maxContextTokens).toBe(100_000);
    expect(DEFAULT_CONFIG.channel).toBe("cli");
  });

  it("Message type accepts text content", () => {
    const msg: Message = {
      role: "user",
      content: [{ type: "text", text: "hello" }],
    };
    expect(msg.role).toBe("user");
    expect(Array.isArray(msg.content)).toBe(true);
  });

  it("Message type accepts string content", () => {
    const msg: Message = {
      role: "user",
      content: "hello",
    };
    expect(msg.content).toBe("hello");
  });
});
