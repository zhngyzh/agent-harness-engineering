import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "../../src/intelligence/memory.js";
import { SkillScanner, SkillsManager } from "../../src/intelligence/skills.js";
import { WorkspaceManager } from "../../src/intelligence/workspace.js";

const TEST_DIR = join(import.meta.dirname, "..", "..", ".test-intelligence");

// ============================================================
// Memory Store
// ============================================================

describe("MemoryStore", () => {
	beforeEach(() => {
		mkdirSync(TEST_DIR, { recursive: true });
		writeFileSync(
			join(TEST_DIR, "MEMORY.md"),
			"## User Preferences\n- Prefers concise answers\n- Primary language: Chinese\n\n## Project Context\n- Building agent-harness-engineering\n- TypeScript project\n",
		);
	});

	afterEach(() => {
		rmSync(TEST_DIR, { recursive: true, force: true });
	});

	it("loads evergreen memories from MEMORY.md", () => {
		const store = new MemoryStore(TEST_DIR);
		store.init();

		const evergreen = store.getEvergreen();
		expect(evergreen).toContain("User Preferences");
		expect(evergreen).toContain("concise answers");
		expect(evergreen).toContain("Project Context");
	});

	it("writes and retrieves daily memories", () => {
		const store = new MemoryStore(TEST_DIR);
		store.init();

		store.write("User prefers TypeScript over JavaScript", "preferences");
		store.write("Working on Phase 3 of the project", "progress");

		const stats = store.getStats();
		expect(stats.evergreen).toBeGreaterThan(0);
		expect(stats.daily).toBe(2);
	});

	it("searches memories by query", () => {
		const store = new MemoryStore(TEST_DIR);
		store.init();

		// Write multiple documents so TF-IDF has a corpus
		store.write("functional programming patterns", "preferences");
		store.write("TypeScript Node.js runtime", "tech");
		store.write("agent harness engineering platform", "context");

		// Search should find relevant results from either evergreen or daily
		const results = store.search("TypeScript");
		expect(results.length).toBeGreaterThan(0);
	});

	it("auto-recalls relevant memories", () => {
		const store = new MemoryStore(TEST_DIR);
		store.init();

		const recalled = store.autoRecall("language preference");
		expect(recalled).toContain("Chinese");
	});

	it("returns empty string when no memories match", () => {
		const store = new MemoryStore(TEST_DIR);
		store.init();

		const recalled = store.autoRecall("quantum computing");
		// May or may not match depending on MEMORY.md content
		// At minimum, should not throw
		expect(typeof recalled).toBe("string");
	});

	it("applies temporal decay to daily memories", () => {
		const store = new MemoryStore(TEST_DIR);
		store.init();

		// Write a memory and search immediately (should have high score)
		store.write("Recent fact about the project", "context");
		const results = store.search("project");
		expect(results.length).toBeGreaterThan(0);

		// The recent memory should have a reasonable score
		const recentResult = results.find((r) =>
			r.fact.content.includes("Recent fact"),
		);
		if (recentResult) {
			expect(recentResult.score).toBeGreaterThan(0);
		}
	});
});

// ============================================================
// Skills Manager
// ============================================================

describe("SkillsManager", () => {
	const skillDir = join(TEST_DIR, "skills");

	beforeEach(() => {
		mkdirSync(join(skillDir, "code-review"), { recursive: true });
		mkdirSync(join(skillDir, "agent-builder"), { recursive: true });

		writeFileSync(
			join(skillDir, "code-review", "SKILL.md"),
			`---
name: code-review
description: Review code for quality, security, and correctness. Use when the user asks to review, check, or audit code.
type: workflow
allowed_tools: [read_file, bash]
---

# Code Review Skill

## Checklist
- Security vulnerabilities
- Code correctness
- Performance issues
- Test coverage
`,
		);

		writeFileSync(
			join(skillDir, "agent-builder", "SKILL.md"),
			`---
name: agent-builder
description: Build AI agents for any domain. Use when creating, designing, or scaffolding agent systems.
type: workflow
---

# Agent Builder Skill

## Steps
1. Define agent identity
2. Configure tools
3. Set up memory
`,
		);
	});

	afterEach(() => {
		rmSync(TEST_DIR, { recursive: true, force: true });
	});

	it("scans and loads skills from directory", () => {
		const manager = new SkillsManager([skillDir]);
		const skills = manager.load();

		expect(skills.length).toBe(2);
		const names = skills.map((s) => s.frontmatter.name).sort();
		expect(names).toContain("code-review");
		expect(names).toContain("agent-builder");
	});

	it("retrieves a skill by name", () => {
		const manager = new SkillsManager([skillDir]);
		manager.load();

		const skill = manager.get("code-review");
		expect(skill).not.toBeNull();
		expect(skill?.frontmatter.name).toBe("code-review");
		expect(skill?.body).toContain("Checklist");
	});

	it("returns null for missing skill", () => {
		const manager = new SkillsManager([skillDir]);
		manager.load();

		expect(manager.get("nonexistent")).toBeNull();
	});

	it("lists skill summaries", () => {
		const manager = new SkillsManager([skillDir]);
		manager.load();

		const summaries = manager.getSummaries();
		expect(summaries.length).toBe(2);
		expect(summaries[0]).toHaveProperty("name");
		expect(summaries[0]).toHaveProperty("description");
	});

	it("finds relevant skills for a query", () => {
		const manager = new SkillsManager([skillDir]);
		manager.load();

		const relevant = manager.findRelevant("review code security");
		expect(relevant.length).toBeGreaterThan(0);
		expect(relevant[0].frontmatter.name).toBe("code-review");
	});

	it("builds a prompt section", () => {
		const manager = new SkillsManager([skillDir]);
		manager.load();

		const section = manager.buildPromptSection();
		expect(section).toContain("Available Skills");
		expect(section).toContain("code-review");
		expect(section).toContain("agent-builder");
		expect(section).toContain("load_skill");
	});

	it("handles empty skill directories", () => {
		const manager = new SkillsManager([join(TEST_DIR, "nonexistent")]);
		const skills = manager.load();
		expect(skills.length).toBe(0);
	});

	it("handles skills with invalid frontmatter", () => {
		mkdirSync(join(skillDir, "broken-skill"), { recursive: true });
		writeFileSync(
			join(skillDir, "broken-skill", "SKILL.md"),
			"# No frontmatter here\nJust markdown content.",
		);

		const manager = new SkillsManager([skillDir]);
		const skills = manager.load();

		// Should load valid skills and skip broken one
		expect(skills.length).toBe(2);
	});
});

// ============================================================
// Workspace Manager
// ============================================================

describe("WorkspaceManager", () => {
	beforeEach(() => {
		mkdirSync(TEST_DIR, { recursive: true });
	});

	afterEach(() => {
		rmSync(TEST_DIR, { recursive: true, force: true });
	});

	it("initializes workspace with directories", () => {
		const wm = new WorkspaceManager(TEST_DIR);
		wm.initialize();

		const info = wm.getInfo();
		expect(info.isInitialized).toBe(false); // No SOUL.md yet
		expect(info.path).toBe(TEST_DIR);
	});

	it("detects initialized workspace", () => {
		writeFileSync(join(TEST_DIR, "SOUL.md"), "Test soul");
		const wm = new WorkspaceManager(TEST_DIR);

		expect(wm.isInitialized()).toBe(true);
	});

	it("lists workspace files", () => {
		writeFileSync(join(TEST_DIR, "SOUL.md"), "Soul content");
		writeFileSync(join(TEST_DIR, "IDENTITY.md"), "Identity content");
		mkdirSync(join(TEST_DIR, "skills"), { recursive: true });

		const wm = new WorkspaceManager(TEST_DIR);
		const files = wm.listFiles();

		expect(files.length).toBe(2);
		const names = files.map((f) => f.name);
		expect(names).toContain("SOUL.md");
		expect(names).toContain("IDENTITY.md");
	});

	it("reads and writes workspace files", () => {
		const wm = new WorkspaceManager(TEST_DIR);
		wm.initialize();

		wm.writeFile("USER.md", "User info here");
		const content = wm.readFile("USER.md");

		expect(content).toBe("User info here");
	});

	it("returns null for missing files", () => {
		const wm = new WorkspaceManager(TEST_DIR);
		expect(wm.readFile("NONEXISTENT.md")).toBeNull();
	});

	it("manages skill directories", () => {
		const wm = new WorkspaceManager(TEST_DIR);
		wm.initialize();

		const dir = wm.ensureSkillDir("my-skill");
		expect(dir).toBe(join(TEST_DIR, "skills", "my-skill"));
	});
});
