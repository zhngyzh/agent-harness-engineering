/**
 * Nudge — Reflection Mechanism
 *
 * Monitors agent behavior and delivers contextual nudges (reminders)
 * when patterns indicate the agent is drifting from optimal behavior.
 *
 * Nudge types:
 *   1. Tool reminder — "You've been using bash for file ops, consider read_file"
 *   2. Context warning — "Context is 80% full, consider compacting"
 *   3. Error pattern — "This tool failed 3 times, try a different approach"
 *   4. Memory hint — "You mentioned this before, check MEMORY.md"
 *   5. Review-based — "Self-review found: high error rate on bash calls"
 *
 * Design (from Hermes / knowledge base):
 *   - Nudges are injected into the system prompt as a special section
 *   - Non-blocking: agent can ignore nudges
 *   - Rate-limited: max 3 nudges per turn to avoid overwhelming context
 *   - Priority-ordered: critical > warning > info
 *   - Temporal decay: old nudges fade after 5 turns
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Logger } from "../observability/logger.js";
import type { ReviewReport } from "./self-review.js";

export type NudgePriority = "critical" | "warning" | "info";

export interface Nudge {
	id: string;
	type:
		| "tool_reminder"
		| "context_warning"
		| "error_pattern"
		| "memory_hint"
		| "review_based";
	priority: NudgePriority;
	message: string;
	source: string; // What triggered this nudge
	createdAt: string;
	expiresAt: string; // ISO timestamp
	acknowledged: boolean;
}

export interface NudgeSection {
	nudges: Nudge[];
	formatted: string; // Ready-to-inject into system prompt
}

export class NudgeEngine {
	private log = new Logger("nudge");
	private nudges: Nudge[] = [];
	private nudgeDir: string;
	private maxActiveNudges = 10;
	private maxPerTurn = 3;
	private ttlTurns = 5;
	private turnCount = 0;

	constructor(workspaceDir: string) {
		this.nudgeDir = join(workspaceDir, ".nudges");
		mkdirSync(this.nudgeDir, { recursive: true });
	}

	/**
	 * Advance the turn counter.
	 * Call this at the start of each agent turn.
	 */
	nextTurn(): void {
		this.turnCount++;
		// Expire old nudges
		const now = new Date().toISOString();
		this.nudges = this.nudges.filter((n) => n.expiresAt > now);
	}

	/**
	 * Generate nudges from a review report.
	 */
	fromReview(report: ReviewReport): Nudge[] {
		const nudges: Nudge[] = [];

		for (const finding of report.findings) {
			if (finding.severity === "info") continue; // Only warning+

			const nudge: Nudge = {
				id: `nudge-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
				type: "review_based",
				priority: finding.severity === "critical" ? "critical" : "warning",
				message: finding.suggestion
					? `${finding.description}. Suggestion: ${finding.suggestion}`
					: finding.description,
				source: `review:${report.id}`,
				createdAt: new Date().toISOString(),
				expiresAt: new Date(Date.now() + this.ttlTurns * 60_000).toISOString(), // 5 min TTL
				acknowledged: false,
			};

			nudges.push(nudge);
		}

		this.addNudges(nudges);
		return nudges;
	}

	/**
	 * Generate a nudge from repeated tool errors.
	 */
	fromToolErrors(tool: string, errorCount: number, suggestion?: string): Nudge {
		const nudge: Nudge = {
			id: `nudge-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
			type: "error_pattern",
			priority: errorCount >= 3 ? "critical" : "warning",
			message: suggestion
				? `"${tool}" failed ${errorCount} times. ${suggestion}`
				: `"${tool}" has failed ${errorCount} times. Consider a different approach.`,
			source: `tool_errors:${tool}`,
			createdAt: new Date().toISOString(),
			expiresAt: new Date(Date.now() + this.ttlTurns * 60_000).toISOString(),
			acknowledged: false,
		};

		this.addNudges([nudge]);
		return nudge;
	}

	/**
	 * Generate a context usage warning nudge.
	 */
	fromContextUsage(usagePercent: number): Nudge | null {
		if (usagePercent < 0.7) return null;

		const nudge: Nudge = {
			id: `nudge-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
			type: "context_warning",
			priority: usagePercent > 0.9 ? "critical" : "warning",
			message:
				usagePercent > 0.9
					? `Context is ${Math.round(usagePercent * 100)}% full! Compact immediately.`
					: `Context is ${Math.round(usagePercent * 100)}% full. Consider compacting soon.`,
			source: "context_monitor",
			createdAt: new Date().toISOString(),
			expiresAt: new Date(Date.now() + this.ttlTurns * 60_000).toISOString(),
			acknowledged: false,
		};

		this.addNudges([nudge]);
		return nudge;
	}

	/**
	 * Generate a tool reminder nudge.
	 */
	fromToolUsage(overusedTool: string, suggestedTool: string): Nudge {
		const nudge: Nudge = {
			id: `nudge-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
			type: "tool_reminder",
			priority: "info",
			message: `You've been using "${overusedTool}" frequently. Consider "${suggestedTool}" for this task.`,
			source: "tool_monitor",
			createdAt: new Date().toISOString(),
			expiresAt: new Date(Date.now() + this.ttlTurns * 60_000).toISOString(),
			acknowledged: false,
		};

		this.addNudges([nudge]);
		return nudge;
	}

	/**
	 * Get the current nudge section for injection into system prompt.
	 * Limited to maxPerTurn nudges, priority-ordered.
	 */
	getSection(): NudgeSection {
		const active = this.nudges
			.filter((n) => !n.acknowledged)
			.sort((a, b) => {
				const prio = { critical: 0, warning: 1, info: 2 };
				return prio[a.priority] - prio[b.priority];
			})
			.slice(0, this.maxPerTurn);

		if (active.length === 0) {
			return { nudges: [], formatted: "" };
		}

		const lines = [
			"## Nudges (reflection reminders)",
			...active.map((n) => `- **[${n.priority}]** ${n.message}`),
			"",
		];

		return {
			nudges: active,
			formatted: lines.join("\n"),
		};
	}

	/** Acknowledge a nudge (mark as read) */
	acknowledge(nudgeId: string): boolean {
		const nudge = this.nudges.find((n) => n.id === nudgeId);
		if (nudge) {
			nudge.acknowledged = true;
			return true;
		}
		return false;
	}

	/** Get all active nudges */
	getActive(): Nudge[] {
		const now = new Date().toISOString();
		return this.nudges.filter((n) => !n.acknowledged && n.expiresAt > now);
	}

	/** List all nudges (including expired/acknowledged) */
	listAll(): Nudge[] {
		return [...this.nudges].sort((a, b) =>
			b.createdAt.localeCompare(a.createdAt),
		);
	}

	/** Clear all nudges */
	clear(): void {
		this.nudges = [];
		this.log.info("All nudges cleared");
	}

	// ============================================================
	// Private
	// ============================================================

	private addNudges(newNudges: Nudge[]): void {
		this.nudges.push(...newNudges);

		// Cap active nudges
		if (this.nudges.length > this.maxActiveNudges) {
			// Remove oldest info nudges first
			const toRemove = this.nudges.length - this.maxActiveNudges;
			this.nudges.sort((a, b) => {
				const prio = { critical: 0, warning: 1, info: 2 };
				return prio[a.priority] - prio[b.priority];
			});
			this.nudges.splice(this.nudges.length - toRemove);
		}

		for (const nudge of newNudges) {
			this.log.info(
				`Nudge created: [${nudge.priority}] ${nudge.message.slice(0, 60)}`,
			);
			this.saveNudge(nudge);
		}
	}

	private saveNudge(nudge: Nudge): void {
		const today = new Date().toISOString().slice(0, 10);
		const filePath = join(this.nudgeDir, `${today}.jsonl`);
		appendFileSync(filePath, `${JSON.stringify(nudge)}\n`, "utf-8");
	}
}
