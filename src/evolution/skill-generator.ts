/**
 * Skill Generator
 *
 * Automatically generates new Skill candidates by analyzing:
 *   1. Repeated workflow patterns in traces (same tool sequence)
 *   2. High-quality review findings that suggest skill creation
 *   3. User corrections ("No, I meant...") that indicate missing knowledge
 *
 * Generated skills are saved as drafts in .skill-drafts/ for human review.
 * Only after human approval are they moved to the real skills/ directory.
 *
 * Design (from Hermes / knowledge base):
 *   - Skills are knowledge injection, not code
 *   - description field is critical: must include trigger phrases
 *   - Negative instructions prevent misuse
 *   - Always draft-first, human-approve-second
 */

import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { Logger } from "../observability/logger.js";
import type { ToolSpan } from "../observability/tracing.js";
import type { ReviewReport } from "./self-review.js";

export interface SkillDraft {
	id: string;
	name: string;
	description: string;
	body: string;
	invocation: string;
	allowed_tools: string[];
	source: "trace_pattern" | "review_finding" | "user_correction";
	confidence: number; // 0-1
	createdAt: string;
	status: "draft" | "approved" | "rejected";
}

/**
 * Pattern detector: finds repeated tool sequences in traces.
 */
interface ToolPattern {
	sequence: string[]; // e.g. ["bash", "read_file", "edit_file"]
	count: number;
	toolSpans: ToolSpan[][];
}

export class SkillGenerator {
	private log = new Logger("skill-generator");
	private draftsDir: string;

	constructor(workspaceDir: string) {
		this.draftsDir = join(workspaceDir, ".skill-drafts");
		mkdirSync(this.draftsDir, { recursive: true });
	}

	/**
	 * Analyze tool traces for repeated patterns.
	 * Each pattern that appears >= threshold times becomes a skill draft.
	 */
	analyzePatterns(toolSpans: ToolSpan[], minOccurrences = 3): SkillDraft[] {
		const drafts: SkillDraft[] = [];
		const patterns = this.extractPatterns(toolSpans);

		for (const pattern of patterns) {
			if (pattern.count < minOccurrences) continue;

			const tools = [...new Set(pattern.sequence)];
			const name = this.generateSkillName(pattern.sequence);

			const draft: SkillDraft = {
				id: `draft-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
				name,
				description: `Auto-generated skill for ${pattern.sequence.join(" -> ")} workflow. Trigger when user requests tasks involving ${tools.join(", ")}.`,
				body: this.generateSkillBody(pattern),
				invocation: `When the user asks for ${tools[0]} operations involving ${tools.slice(1).join(", ")}, use this workflow.`,
				allowed_tools: tools,
				source: "trace_pattern",
				confidence: Math.min(1, pattern.count / 10),
				createdAt: new Date().toISOString(),
				status: "draft",
			};

			drafts.push(draft);
			this.saveDraft(draft);
		}

		this.log.info(
			`Generated ${drafts.length} skill drafts from ${patterns.length} patterns`,
		);
		return drafts;
	}

	/**
	 * Generate skill drafts from review reports.
	 * Learning-signal findings with high tool diversity suggest new skills.
	 */
	analyzeReviews(reviews: ReviewReport[]): SkillDraft[] {
		const drafts: SkillDraft[] = [];

		for (const review of reviews) {
			const learningFindings = review.findings.filter(
				(f) => f.dimension === "learning_signal" && f.severity === "info",
			);

			for (const finding of learningFindings) {
				// Parse tool names from the description
				const toolsMatch = finding.description.match(/:\s+(.+)$/);
				const tools = toolsMatch
					? toolsMatch[1].split(", ").map((t) => t.trim())
					: ["unknown"];

				const draft: SkillDraft = {
					id: `draft-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
					name: `auto-${tools[0]}-workflow`,
					description: `Auto-generated from review: ${finding.description}`,
					body: finding.suggestion
						? `Workflow pattern identified by self-review.\n\nSuggestion: ${finding.suggestion}`
						: "Workflow pattern identified by self-review.",
					invocation: `When working with ${tools.join(", ")}, follow this workflow.`,
					allowed_tools: tools,
					source: "review_finding",
					confidence: review.score,
					createdAt: new Date().toISOString(),
					status: "draft",
				};

				drafts.push(draft);
				this.saveDraft(draft);
			}
		}

		return drafts;
	}

	/**
	 * Generate a skill draft from a user correction.
	 */
	fromUserCorrection(tool: string, correction: string): SkillDraft {
		const draft: SkillDraft = {
			id: `draft-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
			name: `correction-${tool}`,
			description: `Correction for ${tool} usage: ${correction}`,
			body: `# ${tool} Correction\n\n${correction}\n\nAlways apply this correction when using ${tool}.`,
			invocation: `When using ${tool}, remember: ${correction}`,
			allowed_tools: [tool],
			source: "user_correction",
			confidence: 0.9,
			createdAt: new Date().toISOString(),
			status: "draft",
		};

		this.saveDraft(draft);
		return draft;
	}

	/** List all skill drafts */
	listDrafts(): SkillDraft[] {
		if (!existsSync(this.draftsDir)) return [];
		const drafts: SkillDraft[] = [];
		for (const file of readdirSync(this.draftsDir)) {
			if (!file.endsWith(".json")) continue;
			try {
				drafts.push(
					JSON.parse(readFileSync(join(this.draftsDir, file), "utf-8")),
				);
			} catch {
				// skip
			}
		}
		return drafts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	}

	/** Approve a draft — moves it to the real skills directory */
	approveDraft(draftId: string, skillsDir: string): string | null {
		const drafts = this.listDrafts();
		const draft = drafts.find((d) => d.id === draftId);
		if (!draft) return null;

		const skillDir = join(skillsDir, draft.name);
		mkdirSync(skillDir, { recursive: true });

		const skillMd = `---
name: "${draft.name}"
description: "${draft.description}"
invocation: "${draft.invocation}"
allowed_tools: [${draft.allowed_tools.map((t) => `"${t}"`).join(", ")}]
type: "workflow"
---

${draft.body}
`;

		writeFileSync(join(skillDir, "SKILL.md"), skillMd, "utf-8");

		// Update draft status
		draft.status = "approved";
		this.saveDraft(draft);

		this.log.info(`Draft approved: ${draft.name} -> ${skillDir}`);
		return skillDir;
	}

	// ============================================================
	// Private
	// ============================================================

	/**
	 * Extract repeated tool sequences using sliding window.
	 * Looks for sequences of length 2-4 that repeat.
	 */
	private extractPatterns(toolSpans: ToolSpan[]): ToolPattern[] {
		const tools = toolSpans.map((s) => s.tool);
		const patterns: ToolPattern[] = [];
		const seen = new Map<string, ToolPattern>();

		for (let len = 2; len <= Math.min(4, tools.length); len++) {
			for (let i = 0; i <= tools.length - len; i++) {
				const seq = tools.slice(i, i + len);
				const key = seq.join("->");

				const existing = seen.get(key);
				if (existing) {
					existing.count++;
					existing.toolSpans.push(toolSpans.slice(i, i + len));
				} else {
					const pattern: ToolPattern = {
						sequence: seq,
						count: 1,
						toolSpans: [toolSpans.slice(i, i + len)],
					};
					seen.set(key, pattern);
					patterns.push(pattern);
				}
			}
		}

		return patterns;
	}

	private generateSkillName(sequence: string[]): string {
		const unique = [...new Set(sequence)];
		if (unique.length <= 2) {
			return `${unique.join("-")}-workflow`;
		}
		return `${unique[0]}-${unique[unique.length - 1]}-workflow`;
	}

	private generateSkillBody(pattern: ToolPattern): string {
		const steps = pattern.sequence
			.map((tool, i) => `${i + 1}. Use **${tool}**`)
			.join("\n");
		return `# Auto-Generated Workflow

## Steps
${steps}

## Notes
- This workflow was auto-detected from ${pattern.count} occurrences
- Review and customize before use
- Add error handling as needed
`;
	}

	private saveDraft(draft: SkillDraft): void {
		const filePath = join(this.draftsDir, `${draft.id}.json`);
		writeFileSync(filePath, JSON.stringify(draft, null, 2), "utf-8");
	}
}
