import { beforeEach, describe, expect, it } from "vitest";
import { ContextLayerManager } from "../../src/context/layers.js";
import type { Message } from "../../src/core/types.js";

describe("ContextLayerManager", () => {
	let manager: ContextLayerManager;

	beforeEach(() => {
		manager = new ContextLayerManager();
	});

	const baseConfig = {
		name: "Test",
		model: "claude-sonnet-4-20250514",
		workspaceDir: "./workspace",
		maxTokens: 4096,
		maxTurns: 10,
		maxContextTokens: 100_000,
		language: "zh",
		channel: "cli" as const,
	};

	it("assembles all layers into a prompt", () => {
		const files = new Map<string, string>();
		files.set("IDENTITY.md", "I am a test agent.");
		files.set("SOUL.md", "Be concise and direct.");

		const prompt = manager.assemble(
			baseConfig,
			files,
			"code-review: Review code quality",
			"User prefers TypeScript.",
		);

		expect(prompt).toContain("I am a test agent");
		expect(prompt).toContain("Be concise and direct");
		expect(prompt).toContain("code-review");
		expect(prompt).toContain("TypeScript");
	});

	it("includes runtime info (channel, language)", () => {
		const prompt = manager.assemble(baseConfig, new Map(), "", "");

		expect(prompt).toContain("cli");
		expect(prompt).toContain("zh");
		expect(prompt).toContain("Runtime");
	});

	it("handles missing resident files gracefully", () => {
		const prompt = manager.assemble(baseConfig, new Map(), "", "");

		expect(prompt).not.toContain("Identity");
		expect(prompt).not.toContain("Communication Style");
	});

	it("includes only present resident files", () => {
		const files = new Map<string, string>();
		files.set("IDENTITY.md", "My identity");
		// SOUL.md missing

		const prompt = manager.assemble(baseConfig, files, "", "");

		expect(prompt).toContain("My identity");
		expect(prompt).not.toContain("Communication Style");
	});

	it("omits skills section when empty", () => {
		const prompt = manager.assemble(baseConfig, new Map(), "", "");

		expect(prompt).not.toContain("Skills");
	});

	it("omits memories section when empty", () => {
		const prompt = manager.assemble(baseConfig, new Map(), "", "");

		expect(prompt).not.toContain("Memories");
	});

	it("estimates token usage correctly", () => {
		const messages: Message[] = [
			{ role: "user", content: "hello" },
			{ role: "assistant", content: "hi there" },
		];

		const usage = manager.estimateUsage(messages, 1000);
		expect(usage.estimatedTokens).toBeGreaterThan(0);
		expect(usage.ratio).toBeGreaterThan(0);
	});

	it("returns zero ratio for empty messages", () => {
		const usage = manager.estimateUsage([], 1000);
		expect(usage.estimatedTokens).toBe(0);
		expect(usage.ratio).toBe(0);
	});

	it("ratio increases with more messages", () => {
		const shortMessages: Message[] = [{ role: "user", content: "hi" }];
		const longMessages: Message[] = [
			{ role: "user", content: "x".repeat(4000) },
			{ role: "assistant", content: "y".repeat(4000) },
		];

		const shortUsage = manager.estimateUsage(shortMessages, 10_000);
		const longUsage = manager.estimateUsage(longMessages, 10_000);

		expect(longUsage.ratio).toBeGreaterThan(shortUsage.ratio);
	});

	it("handles array content in messages", () => {
		const messages: Message[] = [
			{
				role: "user",
				content: [{ type: "text" as const, text: "hello world" }],
			},
		];

		const usage = manager.estimateUsage(messages, 1000);
		expect(usage.estimatedTokens).toBeGreaterThan(0);
	});
});
