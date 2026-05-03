import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { BootstrapLoader } from "../../src/context/bootstrap.js";
import { SystemPromptBuilder } from "../../src/context/builder.js";
import { microCompact, ContextCompactor } from "../../src/context/compaction.js";
import { PromptCache } from "../../src/context/cache.js";
import { MockLLMClient } from "../../src/core/anthropic-client.js";
import { CACHE_BOUNDARY } from "../../src/core/constants.js";
import type { Message } from "../../src/core/types.js";

const TEST_DIR = join(import.meta.dirname, "..", "..", ".test-context");

describe("BootstrapLoader", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("loads existing workspace files", () => {
    writeFileSync(join(TEST_DIR, "SOUL.md"), "Be helpful and concise.");
    writeFileSync(join(TEST_DIR, "IDENTITY.md"), "You are a test assistant.");

    const loader = new BootstrapLoader(TEST_DIR);
    const result = loader.load();

    expect(result.files.length).toBe(2);
    expect(result.files[0].name).toBe("SOUL.md");
    expect(result.files[0].content).toContain("Be helpful");
  });

  it("skips missing files gracefully", () => {
    writeFileSync(join(TEST_DIR, "SOUL.md"), "Soul content");
    // IDENTITY.md is missing

    const loader = new BootstrapLoader(TEST_DIR);
    const result = loader.load();

    expect(result.files.length).toBe(1);
  });

  it("truncates files exceeding per-file limit", () => {
    const longContent = "x".repeat(25_000);
    writeFileSync(join(TEST_DIR, "SOUL.md"), longContent);

    const loader = new BootstrapLoader(TEST_DIR);
    const result = loader.load();

    expect(result.files[0].truncated).toBe(true);
    expect(result.files[0].chars).toBeLessThanOrEqual(20_000 + 50); // + truncation message
  });

  it("loads a single file by name", () => {
    writeFileSync(join(TEST_DIR, "MEMORY.md"), "User prefers concise answers.");

    const loader = new BootstrapLoader(TEST_DIR);
    const file = loader.loadOne("MEMORY.md");

    expect(file).not.toBeNull();
    expect(file?.content).toContain("concise");
  });

  it("returns null for missing file", () => {
    const loader = new BootstrapLoader(TEST_DIR);
    const file = loader.loadOne("NONEXISTENT.md");
    expect(file).toBeNull();
  });
});

describe("SystemPromptBuilder", () => {
  it("builds a prompt with all layers", () => {
    const builder = new SystemPromptBuilder();
    const prompt = builder.build({
      identity: "You are a test assistant.",
      soul: "Be concise.",
      tools: "Available: bash, read_file",
      skills: [
        { name: "code-review", description: "Review code for quality" },
      ],
      memories: [
        { content: "User prefers TypeScript.", score: 0.9 },
      ],
      runtime: {
        currentTime: "2026-01-01T00:00:00Z",
        channel: "cli",
        sessionId: "test-123",
        language: "en",
      },
    });

    expect(prompt).toContain("You are a test assistant");
    expect(prompt).toContain("Be concise");
    expect(prompt).toContain("code-review");
    expect(prompt).toContain("TypeScript");
    expect(prompt).toContain("test-123");
    expect(prompt).toContain(CACHE_BOUNDARY);
  });

  it("builds a minimal prompt", () => {
    const builder = new SystemPromptBuilder();
    const prompt = builder.buildMinimal("You are a helper.", "Tools: bash");

    expect(prompt).toContain("You are a helper");
    expect(prompt).toContain("Tools: bash");
  });
});

describe("Micro-Compact", () => {
  it("truncates long tool results", () => {
    const longContent = "x".repeat(5000);
    const messages: Message[] = [
      {
        role: "user",
        content: [{ type: "text", text: "run command" }],
      },
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "t1", name: "bash", input: { command: "cat bigfile" } }],
      },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "t1", content: longContent }],
      },
    ];

    const compacted = microCompact(messages);
    const resultBlock = (compacted[2].content as { type: string; content: string }[])[0];
    expect(resultBlock.content.length).toBeLessThan(longContent.length);
    expect(resultBlock.content).toContain("truncated");
  });

  it("preserves short tool results", () => {
    const messages: Message[] = [
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "t1", content: "short result" }],
      },
    ];

    const compacted = microCompact(messages);
    const resultBlock = (compacted[0].content as { type: string; content: string }[])[0];
    expect(resultBlock.content).toBe("short result");
  });
});

describe("ContextCompactor", () => {
  it("does not compact when under threshold", async () => {
    const llm = new MockLLMClient();
    const compactor = new ContextCompactor(llm, "test-model", 4096);

    const messages: Message[] = [
      { role: "user", content: [{ type: "text", text: "hello" }] },
      { role: "assistant", content: [{ type: "text", text: "hi" }] },
    ];

    expect(compactor.shouldCompact(messages, 100_000)).toBe(false);
  });

  it("triggers compaction when over threshold", async () => {
    const llm = new MockLLMClient();
    const compactor = new ContextCompactor(llm, "test-model", 4096);

    // Create enough messages to exceed threshold
    const messages: Message[] = [];
    for (let i = 0; i < 20; i++) {
      messages.push({
        role: "user",
        content: [{ type: "text", text: "x".repeat(5000) }],
      });
    }

    expect(compactor.shouldCompact(messages, 10_000)).toBe(true);
  });

  it("refuses to compact too few messages", async () => {
    const llm = new MockLLMClient();
    const compactor = new ContextCompactor(llm, "test-model", 4096);

    const messages: Message[] = [
      { role: "user", content: [{ type: "text", text: "hello" }] },
      { role: "assistant", content: [{ type: "text", text: "hi" }] },
    ];

    const result = await compactor.compact(messages);
    expect(result.compacted).toBe(false);
  });
});

describe("PromptCache", () => {
  it("splits at cache boundary", () => {
    const prompt = `Static content here.
${CACHE_BOUNDARY}
Dynamic content here.`;

    const blocks = PromptCache.split(prompt);

    expect(blocks.length).toBe(3);
    expect(blocks[0].cacheScope).toBe("global");
    expect(blocks[0].text).toContain("Static content");
    expect(blocks[1].cacheScope).toBe(null); // boundary marker
    expect(blocks[2].cacheScope).toBe(null);
    expect(blocks[2].text).toContain("Dynamic content");
  });

  it("handles missing boundary", () => {
    const prompt = "All dynamic content, no boundary.";
    const blocks = PromptCache.split(prompt);

    expect(blocks.length).toBe(1);
    expect(blocks[0].cacheScope).toBe(null);
  });

  it("calculates cache ratio", () => {
    const staticPart = "x".repeat(800);
    const dynamicPart = "y".repeat(200);
    const prompt = `${staticPart}${CACHE_BOUNDARY}${dynamicPart}`;

    const ratio = PromptCache.cacheRatio(prompt);
    expect(ratio).toBeCloseTo(0.8, 1);
  });
});
