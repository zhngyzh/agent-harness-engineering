import { beforeEach, describe, expect, it } from "vitest";
import { SubagentManager } from "../../src/collaboration/subagent.js";
import { MockLLMClient } from "../../src/core/anthropic-client.js";
import type { LLMClient } from "../../src/core/types.js";

// ============================================================
// SubagentManager
// ============================================================

describe("SubagentManager", () => {
	let manager: SubagentManager;

	beforeEach(() => {
		manager = new SubagentManager(
			() => new MockLLMClient() as unknown as LLMClient,
			"You are a helpful subagent. Complete the task and summarize your work.",
		);
	});

	it("spawns a subagent and returns completed result", async () => {
		const result = await manager.spawn({
			task: "Say hello",
			maxTurns: 5,
			timeoutMs: 30_000,
		});

		expect(result.status).toBe("completed");
		expect(result.id).toMatch(/^subagent-/);
		expect(result.summary.length).toBeGreaterThan(0);
		expect(result.turns).toBeGreaterThanOrEqual(0);
		expect(result.durationMs).toBeGreaterThanOrEqual(0);
	});

	it("tracks active subagents for abort", async () => {
		// Start a subagent with a short timeout
		const promise = manager.spawn({
			task: "Quick task",
			maxTurns: 1,
			timeoutMs: 30_000,
		});

		const result = await promise;
		expect(result.status).toBe("completed");
	});

	it("abortAll cleans up running subagents", () => {
		// Should not throw
		manager.abortAll();
	});

	it("abort returns false for unknown id", () => {
		expect(manager.abort("nonexistent")).toBe(false);
	});

	it("uses custom system prompt when provided", async () => {
		const result = await manager.spawn({
			task: "Respond with exactly: CUSTOM_PROMPT_WORKED",
			systemPrompt: "Always respond with exactly: CUSTOM_PROMPT_WORKED",
			maxTurns: 1,
			timeoutMs: 30_000,
		});

		expect(result.status).toBe("completed");
	});

	it("handles subagent failure gracefully", async () => {
		const failingManager = new SubagentManager(
			() =>
				({
					messages: async () => {
						throw new Error("LLM failure");
					},
				}) as LLMClient,
			"You are a test subagent.",
		);

		const result = await failingManager.spawn({
			task: "This should fail",
			maxTurns: 1,
			timeoutMs: 30_000,
		});

		expect(result.status).toBe("failed");
		expect(result.error).toBeDefined();
	});

	it("respects maxTurns limit", async () => {
		const result = await manager.spawn({
			task: "Simple task",
			maxTurns: 1,
			timeoutMs: 30_000,
		});

		expect(result.turns).toBeLessThanOrEqual(1);
	});
});
