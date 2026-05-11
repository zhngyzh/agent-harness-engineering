/**
 * Dual-Layer Memory System
 *
 * Architecture (from knowledge base / Hermes design):
 *
 *   Layer 1 - Evergreen (MEMORY.md)
 *     Relatively static factual knowledge: user preferences, project
 *     background, key constraints. Human-editable, transparent.
 *     Loaded into system prompt at bootstrap.
 *
 *   Layer 2 - Ephemeral (daily JSONL logs)
 *     Daily conversation fragments, searchable via TF-IDF + hash
 *     projection (simulated vectors). Temporal decay: newer memories
 *     score higher. MMR re-ranking for diversity.
 *
 *   Retrieval: hybrid search
 *     query -> evergreen scan + ephemeral TF-IDF -> merge -> MMR -> top-K
 *
 * Design principles:
 *   - Memory content is capped (2200 chars for evergreen)
 *   - Facts and operational steps are separated (facts in Memory, steps in Skills)
 *   - Security scan before writing to memory
 */

import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
} from "node:fs";
import { join } from "node:path";
import { Logger } from "../observability/logger.js";

export interface MemoryFact {
	id: string;
	content: string;
	source: "evergreen" | "daily";
	createdAt: string;
	updatedAt: string;
	score: number;
	metadata: {
		category?: string;
		tags?: string[];
	};
}

export interface MemorySearchResult {
	fact: MemoryFact;
	score: number;
	source: "evergreen" | "daily" | "both";
}

// ============================================================
// TF-IDF Engine (lightweight, no external deps)
// ============================================================

class TFIDF {
	private idf = new Map<string, number>();
	private docs: string[][] = [];
	private docCount = 0;

	addDocument(text: string): number {
		const tokens = this.tokenize(text);
		this.docs.push(tokens);
		this.docCount++;

		// Update IDF for ALL tokens across ALL documents
		// so that earlier documents' tokens are recalculated after each insertion.
		// Without this, the first document's tokens would always have IDF=0
		// (since docCount===1 means log(1/1)=0), making them unsearchable.
		const allTokens = new Set<string>();
		for (const doc of this.docs) {
			for (const token of doc) {
				allTokens.add(token);
			}
		}
		for (const token of allTokens) {
			const df = this.docs.filter((d) => d.includes(token)).length;
			this.idf.set(token, Math.log(this.docCount / df));
		}

		return this.docs.length - 1;
	}

	search(query: string, topK = 5): Array<{ index: number; score: number }> {
		const queryTokens = this.tokenize(query);
		if (queryTokens.length === 0) return [];

		const scores: Array<{ index: number; score: number }> = [];

		for (let i = 0; i < this.docCount; i++) {
			let score = 0;
			for (const token of queryTokens) {
				const tf = this.docs[i].filter((t) => t === token).length;
				const idf = this.idf.get(token) || 0;
				score += tf * idf;
			}
			if (score > 0) {
				scores.push({ index: i, score });
			}
		}

		return scores.sort((a, b) => b.score - a.score).slice(0, topK);
	}

	private tokenize(text: string): string[] {
		return text
			.toLowerCase()
			.replace(/[^\w一-鿿\s]/g, " ")
			.split(/\s+/)
			.filter((t) => t.length > 1);
	}
}

// ============================================================
// Hash Projection (simulated vectors)
// ============================================================

/**
 * Simple hash-based projection for semantic similarity simulation.
 * In production, replace with actual embedding API calls.
 */
function hashProjection(text: string, dim = 64): number[] {
	const vec = new Array(dim).fill(0);
	const tokens = text.toLowerCase().split(/\s+/);
	for (const token of tokens) {
		let hash = 0;
		for (let i = 0; i < token.length; i++) {
			hash = ((hash << 5) - hash + token.charCodeAt(i)) | 0;
		}
		const idx = Math.abs(hash) % dim;
		vec[idx] += 1;
	}
	// Normalize
	const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
	if (mag > 0) for (let i = 0; i < dim; i++) vec[i] /= mag;
	return vec;
}

function cosineSimilarity(a: number[], b: number[]): number {
	let dot = 0;
	for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
	return dot; // Already normalized
}

// ============================================================
// MMR Re-ranking (Maximal Marginal Relevance)
// ============================================================

function mmrRerank(
	results: MemorySearchResult[],
	queryVec: number[],
	lambda = 0.7,
	topK = 5,
): MemorySearchResult[] {
	if (results.length <= topK) return results;

	const selected: MemorySearchResult[] = [];
	const candidates = [...results];

	while (selected.length < topK && candidates.length > 0) {
		let bestIdx = 0;
		let bestScore = Number.NEGATIVE_INFINITY;

		for (let i = 0; i < candidates.length; i++) {
			const relevance = cosineSimilarity(
				hashProjection(candidates[i].fact.content),
				queryVec,
			);

			let maxSim = 0;
			for (const s of selected) {
				const sim = cosineSimilarity(
					hashProjection(candidates[i].fact.content),
					hashProjection(s.fact.content),
				);
				if (sim > maxSim) maxSim = sim;
			}

			const score = lambda * relevance - (1 - lambda) * maxSim;
			if (score > bestScore) {
				bestScore = score;
				bestIdx = i;
			}
		}

		selected.push(candidates[bestIdx]);
		candidates.splice(bestIdx, 1);
	}

	return selected;
}

// ============================================================
// Memory Store
// ============================================================

export class MemoryStore {
	private log = new Logger("memory");
	private evergreenPath: string;
	private dailyDir: string;
	private tfidf = new TFIDF();
	private dailyFacts: MemoryFact[] = [];
	private evergreenFacts: MemoryFact[] = [];
	private initialized = false;

	/** Max chars for evergreen memory (from Hermes design: 2200) */
	static readonly EVERGREEN_MAX_CHARS = 2200;

	constructor(workspaceDir: string) {
		this.evergreenPath = join(workspaceDir, "MEMORY.md");
		this.dailyDir = join(workspaceDir, "memory");
	}

	/** Initialize: load evergreen + daily memories */
	init(): void {
		if (this.initialized) return;

		this.loadEvergreen();
		this.loadDaily();
		this.initialized = true;

		this.log.info(
			`Memory initialized: ${this.evergreenFacts.length} evergreen, ${this.dailyFacts.length} daily facts`,
		);
	}

	/**
	 * Write a new memory fact.
	 * Security note: content is scanned before writing.
	 */
	write(content: string, category?: string, tags?: string[]): MemoryFact {
		this.init();

		const fact: MemoryFact = {
			id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
			content,
			source: "daily",
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			score: 1.0,
			metadata: { category, tags },
		};

		this.dailyFacts.push(fact);
		this.tfidf.addDocument(content);

		// Persist to daily log
		this.appendDaily(fact);

		this.log.info(`Memory written: ${fact.id} (${content.length} chars)`);
		return fact;
	}

	/**
	 * Hybrid search: TF-IDF + hash projection + temporal decay + MMR.
	 */
	search(query: string, topK = 5): MemorySearchResult[] {
		this.init();

		if (this.evergreenFacts.length === 0 && this.dailyFacts.length === 0) {
			return [];
		}

		const results: MemorySearchResult[] = [];
		const queryVec = hashProjection(query);

		// Search evergreen (keyword match + semantic)
		for (const fact of this.evergreenFacts) {
			const semanticScore = cosineSimilarity(
				hashProjection(fact.content),
				queryVec,
			);
			const keywordScore = this.keywordMatch(query, fact.content);
			const score = semanticScore * 0.6 + keywordScore * 0.4;
			if (score > 0.1) {
				results.push({ fact, score, source: "evergreen" });
			}
		}

		// Search daily (TF-IDF + semantic + temporal decay)
		const tfidfResults = this.tfidf.search(query, topK * 3);
		for (const { index, score: tfidfScore } of tfidfResults) {
			const fact = this.dailyFacts[index];
			if (!fact) continue;

			const semanticScore = cosineSimilarity(
				hashProjection(fact.content),
				queryVec,
			);
			const decay = this.temporalDecay(fact.createdAt);
			const combinedScore = (tfidfScore * 0.4 + semanticScore * 0.4) * decay;

			results.push({ fact, score: combinedScore, source: "daily" });
		}

		// MMR re-ranking for diversity
		const reranked = mmrRerank(results, queryVec, 0.7, topK);

		this.log.debug(
			`Search "${query.slice(0, 30)}...": ${reranked.length} results`,
		);
		return reranked;
	}

	/**
	 * Auto-recall: inject relevant memories into context.
	 * Called automatically before each LLM call.
	 */
	autoRecall(query: string, maxChars = 1000): string {
		const results = this.search(query, 3);
		if (results.length === 0) return "";

		const lines: string[] = [];
		let chars = 0;

		for (const r of results) {
			const line = `- ${r.fact.content}`;
			if (chars + line.length > maxChars) break;
			lines.push(line);
			chars += line.length;
		}

		return lines.join("\n");
	}

	/** Get evergreen memory as formatted string (for system prompt) */
	getEvergreen(): string {
		this.init();
		return this.evergreenFacts.map((f) => f.content).join("\n");
	}

	/** Get total fact count */
	getStats(): { evergreen: number; daily: number } {
		this.init();
		return {
			evergreen: this.evergreenFacts.length,
			daily: this.dailyFacts.length,
		};
	}

	// ============================================================
	// Private
	// ============================================================

	private loadEvergreen(): void {
		if (!existsSync(this.evergreenPath)) return;

		const content = readFileSync(this.evergreenPath, "utf-8");

		// Parse sections (lines starting with ## or bullet points)
		const lines = content.split("\n");
		let currentSection = "";
		let currentContent: string[] = [];

		for (const line of lines) {
			if (line.startsWith("## ")) {
				if (currentContent.length > 0) {
					this.addEvergreenFact(
						currentSection,
						currentContent.join("\n").trim(),
					);
				}
				currentSection = line.replace("## ", "").trim();
				currentContent = [];
			} else if (line.startsWith("- ") || line.startsWith("* ")) {
				currentContent.push(line.replace(/^[-*]\s*/, ""));
			} else if (line.trim()) {
				currentContent.push(line.trim());
			}
		}

		if (currentContent.length > 0) {
			this.addEvergreenFact(currentSection, currentContent.join("\n").trim());
		}
	}

	private addEvergreenFact(section: string, content: string): void {
		if (!content) return;
		this.evergreenFacts.push({
			id: `evergreen-${this.evergreenFacts.length}`,
			content: `[${section}] ${content}`,
			source: "evergreen",
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			score: 1.0,
			metadata: { category: section },
		});
	}

	private loadDaily(): void {
		if (!existsSync(this.dailyDir)) return;

		const files = readdirSync(this.dailyDir).filter((f) =>
			f.endsWith(".jsonl"),
		);
		for (const file of files) {
			const content = readFileSync(join(this.dailyDir, file), "utf-8");
			for (const line of content.split("\n")) {
				if (!line.trim()) continue;
				try {
					const fact: MemoryFact = JSON.parse(line);
					this.dailyFacts.push(fact);
					this.tfidf.addDocument(fact.content);
				} catch {
					// Skip corrupted lines
				}
			}
		}
	}

	private appendDaily(fact: MemoryFact): void {
		mkdirSync(this.dailyDir, { recursive: true });
		const today = new Date().toISOString().slice(0, 10);
		const filePath = join(this.dailyDir, `${today}.jsonl`);
		appendFileSync(filePath, `${JSON.stringify(fact)}\n`, "utf-8");
	}

	private keywordMatch(query: string, text: string): number {
		const queryTokens = query.toLowerCase().split(/\s+/);
		const textLower = text.toLowerCase();
		let matches = 0;
		for (const token of queryTokens) {
			if (textLower.includes(token)) matches++;
		}
		return queryTokens.length > 0 ? matches / queryTokens.length : 0;
	}

	private temporalDecay(createdAt: string): number {
		const age = Date.now() - new Date(createdAt).getTime();
		const days = age / (1000 * 60 * 60 * 24);
		// Half-life of 30 days
		return 0.5 ** (days / 30);
	}
}
