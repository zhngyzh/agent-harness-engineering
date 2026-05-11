/**
 * Memory Security Scan
 *
 * Scans memory content before writing to detect:
 *   1. Prompt injection attempts in user-provided content
 *   2. Secrets / API keys that should not be persisted
 *   3. Contradictions with existing memory (evergreen)
 *   4. Off-topic content that dilutes retrieval quality
 *
 * Design (from knowledge base):
 *   - Pre-write scan, auto-rollback on critical findings
 *   - Scan is deterministic (regex + heuristics), no LLM needed
 *   - Contradiction detection via keyword overlap + negation detection
 *   - All findings logged to .memory-scan/ JSONL for audit trail
 */

import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
} from "node:fs";
import { join } from "node:path";
import { INJECTION_PATTERNS } from "../core/constants.js";
import { Logger } from "../observability/logger.js";

export interface ScanFinding {
	type: "injection" | "secret" | "contradiction" | "off_topic";
	severity: "info" | "warning" | "critical";
	description: string;
	matchedPattern?: string;
}

export interface ScanResult {
	id: string;
	contentPreview: string;
	findings: ScanFinding[];
	safe: boolean; // true if no critical/warning findings
	scannedAt: string;
}

// Secret patterns: API keys, tokens, passwords, private keys
const SECRET_PATTERNS = [
	{ pattern: /sk-[a-zA-Z0-9]{20,}/g, label: "API key (sk-*)" },
	{ pattern: /Bearer\s+[a-zA-Z0-9._-]{20,}/gi, label: "Bearer token" },
	{ pattern: /password\s*[:=]\s*\S+/gi, label: "Password assignment" },
	{
		pattern: /-----BEGIN\s+(RSA|EC|DSA|OPENSSH)\s+PRIVATE\s+KEY-----/g,
		label: "Private key",
	},
	{ pattern: /ghp_[a-zA-Z0-9]{36}/g, label: "GitHub PAT" },
	{ pattern: /AKIA[0-9A-Z]{16}/g, label: "AWS Access Key" },
];

// Topic keywords for relevance checking
const CORE_TOPICS = [
	"user",
	"preference",
	"project",
	"agent",
	"tool",
	"skill",
	"memory",
	"workflow",
	"config",
	"setting",
	"behavior",
	"rule",
	"constraint",
	"goal",
	"task",
	"context",
];

export class MemoryScanner {
	private log = new Logger("memory-scan");
	private scanDir: string;

	constructor(workspaceDir: string) {
		this.scanDir = join(workspaceDir, ".memory-scan");
		mkdirSync(this.scanDir, { recursive: true });
	}

	/**
	 * Scan memory content before writing.
	 * Returns a ScanResult with findings and safety assessment.
	 */
	scan(content: string, existingEvergreen?: string): ScanResult {
		const findings: ScanFinding[] = [];

		// Check 1: Injection patterns
		for (const pattern of INJECTION_PATTERNS) {
			if (pattern.test(content)) {
				findings.push({
					type: "injection",
					severity: "critical",
					description: "Potential prompt injection detected",
					matchedPattern: pattern.source,
				});
			}
		}

		// Check 2: Secrets
		for (const { pattern, label } of SECRET_PATTERNS) {
			const matches = content.match(pattern);
			if (matches) {
				findings.push({
					type: "secret",
					severity: "critical",
					description: `Secret detected: ${label} (${matches.length} occurrence(s))`,
					matchedPattern: label,
				});
			}
		}

		// Check 3: Contradictions with existing evergreen memory
		if (existingEvergreen) {
			const contradictions = this.detectContradictions(
				content,
				existingEvergreen,
			);
			findings.push(...contradictions);
		}

		// Check 4: Off-topic content
		const topicScore = this.estimateTopicRelevance(content);
		if (topicScore < 0.1 && content.length > 100) {
			findings.push({
				type: "off_topic",
				severity: "warning",
				description:
					"Content may be off-topic for agent memory (low topic relevance)",
			});
		}

		const criticalCount = findings.filter(
			(f) => f.severity === "critical",
		).length;
		const warningCount = findings.filter(
			(f) => f.severity === "warning",
		).length;

		const result: ScanResult = {
			id: `scan-${Date.now()}`,
			contentPreview: content.slice(0, 80) + (content.length > 80 ? "..." : ""),
			findings,
			safe: criticalCount === 0 && warningCount === 0,
			scannedAt: new Date().toISOString(),
		};

		this.logResult(result);
		return result;
	}

	/**
	 * Quick check — returns true if content is safe to write.
	 */
	isSafe(content: string, existingEvergreen?: string): boolean {
		return this.scan(content, existingEvergreen).safe;
	}

	/** List all scan results */
	listResults(): ScanResult[] {
		if (!existsSync(this.scanDir)) return [];
		const results: ScanResult[] = [];
		for (const file of readdirSync(this.scanDir)) {
			if (!file.endsWith(".jsonl")) continue;
			try {
				const content = readFileSync(join(this.scanDir, file), "utf-8");
				for (const line of content.split("\n")) {
					if (line.trim()) {
						results.push(JSON.parse(line));
					}
				}
			} catch {
				// skip
			}
		}
		return results.sort((a, b) => b.scannedAt.localeCompare(a.scannedAt));
	}

	// ============================================================
	// Private
	// ============================================================

	/**
	 * Detect contradictions by looking for negation pairs.
	 * Simple heuristic: if content says "X is Y" and evergreen says "X is not Y".
	 */
	private detectContradictions(
		content: string,
		evergreen: string,
	): ScanFinding[] {
		const findings: ScanFinding[] = [];

		// Extract "is/is not" statements
		const contentStatements = this.extractStatements(content);
		const evergreenStatements = this.extractStatements(evergreen);

		for (const cs of contentStatements) {
			for (const es of evergreenStatements) {
				// Same subject, opposite polarity
				if (
					cs.subject === es.subject &&
					cs.predicate === es.predicate &&
					cs.negated !== es.negated
				) {
					findings.push({
						type: "contradiction",
						severity: "warning",
						description: `Contradiction: "${cs.full}" vs existing "${es.full}"`,
					});
				}
			}
		}

		return findings;
	}

	private extractStatements(text: string): Array<{
		subject: string;
		predicate: string;
		negated: boolean;
		full: string;
	}> {
		const statements: Array<{
			subject: string;
			predicate: string;
			negated: boolean;
			full: string;
		}> = [];
		// Simple pattern: "X is Y" / "X is not Y"
		const regex =
			/(\w[\w\s]{0,30})\s+(is|are|should|must|will)\s+(not\s+)?([^.!?\n]{3,50})/gi;
		let match: RegExpExecArray | null;
		while (true) {
			match = regex.exec(text);
			if (match === null) break;
			statements.push({
				subject: match[1].trim().toLowerCase(),
				predicate: match[4].trim().toLowerCase(),
				negated: !!match[3],
				full: match[0].trim(),
			});
		}
		return statements;
	}

	/**
	 * Estimate topic relevance by keyword overlap.
	 * Returns 0-1 score.
	 */
	private estimateTopicRelevance(content: string): number {
		const lower = content.toLowerCase();
		const matches = CORE_TOPICS.filter((topic) => lower.includes(topic));
		return matches.length / CORE_TOPICS.length;
	}

	private logResult(result: ScanResult): void {
		const today = new Date().toISOString().slice(0, 10);
		const filePath = join(this.scanDir, `${today}.jsonl`);
		appendFileSync(filePath, `${JSON.stringify(result)}\n`, "utf-8");

		if (!result.safe) {
			this.log.warn(
				`Memory scan: ${result.findings.length} findings for "${result.contentPreview}"`,
			);
		} else {
			this.log.debug(`Memory scan: safe (${result.contentPreview})`);
		}
	}
}
