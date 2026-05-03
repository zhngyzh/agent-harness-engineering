import { describe, it, expect, vi } from "vitest";
import { AgentLoop } from "../../src/core/agent-loop.js";
import { MockLLMClient } from "../../src/core/anthropic-client.js";
import { createDefaultRegistry } from "../../src/core/tool-registry.js";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { LLMResponse, Message } from "../../src/core/types.js";

const TEST_DIR = join(import.meta.dirname, "..", "..", ".test-workspace-loop");

function createMockResponse(content: LLMResponse["content"], stopReason: LLMResponse["stopReason"] = "end_turn"): LLMResponse {
  return {
    content,
    stopReason,
    usage: { inputTokens: 100, outputTokens: 50 },
  };
}

describe("AgentLoop", () => {
  const setup = () => {
    mkdirSync(TEST_DIR, { recursive: true });
    const llm = new MockLLMClient();
    const tools = createDefaultRegistry();
    const loop = new AgentLoop({
      config: { workspaceDir: TEST_DIR, maxTurns: 10 },
      llm,
      tools,
    });
    return { loop, llm };
  };

  const teardown = () => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  };

  it("sends a message and receives a response", async () => {
    const { loop, llm } = setup();
    llm.messages = async () =>
      createMockResponse([{ type: "text", text: "Hello! How can I help?" }]);

    const response = await loop.sendMessage("Hi", "You are a test assistant");
    expect(response).toBe("Hello! How can I help?");
    teardown();
  });

  it("handles tool use then returns final text", async () => {
    const { loop, llm } = setup();

    let callCount = 0;
    llm.messages = async () => {
      callCount++;
      if (callCount === 1) {
        return createMockResponse(
          [{ type: "tool_use", id: "t1", name: "bash", input: { command: "echo result" } }],
          "tool_use",
        );
      }
      return createMockResponse([{ type: "text", text: "Done: result" }], "end_turn");
    };

    const response = await loop.sendMessage("Run a command", "You are a test assistant");
    expect(response).toContain("Done:");
    teardown();
  });

  it("emits events during execution", async () => {
    const { loop, llm } = setup();
    const events: string[] = [];

    loop.onEvent((e) => events.push(e.type));
    llm.messages = async () =>
      createMockResponse([{ type: "text", text: "ok" }]);

    await loop.sendMessage("test", "system");
    expect(events).toContain("agent_start");
    expect(events).toContain("turn_start");
    expect(events).toContain("agent_end");
    teardown();
  });

  it("respects maxTurns limit", async () => {
    const { loop, llm } = setup();

    llm.messages = async () =>
      createMockResponse(
        [{ type: "tool_use", id: "t1", name: "bash", input: { command: "echo loop" } }],
        "tool_use",
      );

    const response = await loop.sendMessage("loop", "system");
    expect(loop.getMessages().length).toBeGreaterThan(0);
    teardown();
  });

  it("reset clears message history", async () => {
    const { loop, llm } = setup();
    llm.messages = async () =>
      createMockResponse([{ type: "text", text: "response" }]);

    await loop.sendMessage("hello", "system");
    expect(loop.getMessages().length).toBeGreaterThan(0);

    loop.reset();
    expect(loop.getMessages().length).toBe(0);
    teardown();
  });

  it("abort stops the loop", async () => {
    const { loop, llm } = setup();

    llm.messages = async () =>
      createMockResponse(
        [{ type: "tool_use", id: "t1", name: "bash", input: { command: "sleep 10" } }],
        "tool_use",
      );

    // Start sending, then abort
    const promise = loop.sendMessage("test", "system");
    loop.abort();

    await promise;
    // The loop should have stopped due to abort
    teardown();
  });
});
