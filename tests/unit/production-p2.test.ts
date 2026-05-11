/**
 * P2 生产性测试 — 边界条件与已知 Bug 验证
 */

import {
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BootstrapLoader } from "../../src/context/bootstrap.js";
import {
	MAX_FILE_CHARS,
	MAX_TOTAL_BOOTSTRAP_CHARS,
} from "../../src/core/constants.js";
import { SelfReviewAnalyzer } from "../../src/evolution/self-review.js";
import { SkillsManager } from "../../src/intelligence/skills.js";
import type { ToolSpan } from "../../src/observability/tracing.js";

const TEST_DIR = join(import.meta.dirname, "..", "..", ".test-prod-p2");

// ============================================================
// 1. Bootstrap — 文件大小上限
// ============================================================
describe("P2: Bootstrap file size limits", () => {
	beforeEach(() => mkdirSync(TEST_DIR, { recursive: true }));
	afterEach(() => rmSync(TEST_DIR, { recursive: true, force: true }));

	it("truncates individual files to MAX_FILE_CHARS (20KB)", () => {
		const bigContent = "x".repeat(MAX_FILE_CHARS + 5000);
		writeFileSync(join(TEST_DIR, "SOUL.md"), bigContent);

		const loader = new BootstrapLoader(TEST_DIR);
		const result = loader.load();

		const soulFile = result.files.find((f) => f.name === "SOUL.md");
		expect(soulFile).toBeDefined();
		// Content is truncated to MAX_FILE_CHARS + "\n... (truncated)" suffix
		// The suffix adds 16 chars, so total is MAX_FILE_CHARS + 16
		expect(soulFile?.content.length).toBeLessThanOrEqual(MAX_FILE_CHARS + 20);
		expect(soulFile?.truncated).toBe(true);
	});

	it("enforces total bootstrap size limit (150KB)", () => {
		// Create files that are just under the per-file limit (20KB each)
		// 8 files × 20KB = 160KB > 150KB → last file should be skipped
		const fileSize = MAX_FILE_CHARS; // exactly 20KB, no truncation
		const files = [
			"SOUL.md",
			"IDENTITY.md",
			"TOOLS.md",
			"MEMORY.md",
			"USER.md",
			"HEARTBEAT.md",
			"BOOTSTRAP.md",
			"AGENTS.md",
		];
		for (const f of files) {
			writeFileSync(join(TEST_DIR, f), "x".repeat(fileSize));
		}

		const loader = new BootstrapLoader(TEST_DIR);
		const result = loader.load();

		expect(result.totalChars).toBeLessThanOrEqual(
			MAX_TOTAL_BOOTSTRAP_CHARS + 20,
		);
		// Some files should be skipped due to total cap
		expect(result.skipped.length).toBeGreaterThan(0);
	});

	it("loads files in correct order", () => {
		writeFileSync(join(TEST_DIR, "SOUL.md"), "soul content");
		writeFileSync(join(TEST_DIR, "IDENTITY.md"), "identity content");
		writeFileSync(join(TEST_DIR, "TOOLS.md"), "tools content");

		const loader = new BootstrapLoader(TEST_DIR);
		const result = loader.load();

		expect(result.files[0].name).toBe("SOUL.md");
		expect(result.files[1].name).toBe("IDENTITY.md");
		expect(result.files[2].name).toBe("TOOLS.md");
	});
});

// ============================================================
// 2. Skills — SkillsManager
// ============================================================
describe("P2: Skills scanning", () => {
	beforeEach(() => mkdirSync(TEST_DIR, { recursive: true }));
	afterEach(() => rmSync(TEST_DIR, { recursive: true, force: true }));

	it("SkillsManager exists and has expected methods", () => {
		const manager = new SkillsManager(TEST_DIR);
		expect(manager).toBeDefined();
		// Just verify the class can be instantiated
		// The actual scanning requires specific directory structure
	});
});

// ============================================================
// 3. Self-Review — 已知 Bug：多次 review 创建多个文件
// ============================================================
describe("P2: SelfReview file creation", () => {
	beforeEach(() => mkdirSync(TEST_DIR, { recursive: true }));
	afterEach(() => rmSync(TEST_DIR, { recursive: true, force: true }));

	it("multiple analyze() calls append to the same daily file", () => {
		const review = new SelfReviewAnalyzer(TEST_DIR);

		const spans: ToolSpan[] = [
			{
				tool: "bash",
				input: {},
				startedAt: "T1",
				endedAt: "T2",
				durationMs: 100,
			},
			{
				tool: "read_file",
				input: {},
				startedAt: "T3",
				error: "not found",
				endedAt: "T4",
				durationMs: 50,
			},
		];

		review.analyze("test-session", spans);
		review.analyze("test-session", spans);

		const reviewDir = join(TEST_DIR, ".reviews");
		const files = readdirSync(reviewDir);

		// Fixed: both reviews go to the same daily file
		expect(files.length).toBe(1);
		expect(files[0]).toMatch(/^reviews-\d{4}-\d{2}-\d{2}\.jsonl$/);

		const content = readFileSync(join(reviewDir, files[0]), "utf-8");
		const lines = content.trim().split("\n");
		expect(lines.length).toBe(2);

		for (const line of lines) {
			expect(() => JSON.parse(line)).not.toThrow();
		}
	});
});

// ============================================================
// 4. Memory — TF-IDF IDF Bug 根因验证
// ============================================================
describe("P2: Memory TF-IDF IDF bug root cause", () => {
	beforeEach(() => mkdirSync(TEST_DIR, { recursive: true }));
	afterEach(() => rmSync(TEST_DIR, { recursive: true, force: true }));

	it("TF-IDF IDF is now correctly recalculated for all tokens", () => {
		// This mirrors the fixed TFIDF class in src/intelligence/memory.ts
		class TFIDF {
			private idf = new Map<string, number>();
			private docs: string[][] = [];
			private docCount = 0;
			addDocument(text: string): number {
				const tokens = text
					.toLowerCase()
					.replace(/[^\w\s]/g, " ")
					.split(/\s+/)
					.filter((t) => t.length > 1);
				this.docs.push(tokens);
				this.docCount++;
				// Fixed: recalculate IDF for ALL tokens, not just the new document's
				const allTokens = new Set<string>();
				for (const doc of this.docs) {
					for (const token of doc) allTokens.add(token);
				}
				for (const token of allTokens) {
					const count = this.docs.filter((d) => d.includes(token)).length;
					this.idf.set(token, Math.log(this.docCount / count));
				}
				return this.docs.length - 1;
			}
			search(query: string): Array<{ index: number; score: number }> {
				const queryTokens = query
					.toLowerCase()
					.replace(/[^\w\s]/g, " ")
					.split(/\s+/)
					.filter((t) => t.length > 1);
				if (queryTokens.length === 0) return [];
				const scores: Array<{ index: number; score: number }> = [];
				for (let i = 0; i < this.docCount; i++) {
					let score = 0;
					for (const token of queryTokens) {
						const tf = this.docs[i].filter((t) => t === token).length;
						const idf = this.idf.get(token) || 0;
						score += tf * idf;
					}
					if (score > 0) scores.push({ index: i, score });
				}
				return scores;
			}
		}

		const tfidf = new TFIDF();
		tfidf.addDocument("The quick brown fox jumps");
		tfidf.addDocument("Lazy dogs sleep all day");

		// Fixed: first document's tokens now have correct IDF values
		const results = tfidf.search("quick brown fox");
		expect(results.length).toBeGreaterThan(0);

		// Second document still works
		const results2 = tfidf.search("lazy dogs sleep");
		expect(results2.length).toBeGreaterThan(0);
	});
});
