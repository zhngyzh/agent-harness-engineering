/**
 * Permission Engine
 *
 * Three-tier permission model: Allow / Deny / Ask
 *
 * Rules are evaluated in order; first match wins.
 * Default policy: Deny (secure by default).
 *
 * Permission scopes:
 *   - tool:* or tool:bash — tool execution
 *   - file:read:*, file:write:/tmp/* — file operations (glob patterns)
 *   - net:* — network access
 *   - env:read:*, env:write:* — environment variables
 *   - session:*, system:* — session and system operations
 *
 * Design principles:
 *   - Secure by default: no rule = deny
 *   - Explicit allow required
 *   - Rules are ordered: first match wins
 *   - "Ask" defers to human approval
 *   - All decisions are logged for audit
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Logger } from "../observability/logger.js";

export type PermissionDecision = "allow" | "deny" | "ask";

export interface PermissionRule {
	id: string;
	pattern: string; // glob pattern, e.g. "tool:bash", "file:read:*"
	decision: PermissionDecision;
	priority: number; // lower = evaluated first
	description?: string;
	createdAt: string;
}

export interface PermissionRequest {
	subject: string; // e.g. "tool:bash", "file:write:/etc/passwd"
	context?: Record<string, unknown>;
	timestamp: string;
}

export interface PermissionResult {
	request: PermissionRequest;
	decision: PermissionDecision;
	matchedRule?: PermissionRule;
	evaluatedAt: string;
}

/**
 * Simple glob matcher.
 * Supports: * (any chars), ? (single char), ** (any path segments)
 */
function matchesGlob(pattern: string, input: string): boolean {
	// Convert glob to regex
	let regexStr = "^";
	for (let i = 0; i < pattern.length; i++) {
		const ch = pattern[i];
		if (ch === "*") {
			if (pattern[i + 1] === "*") {
				regexStr += ".*";
				i++; // skip next *
			} else {
				regexStr += "[^/]*";
			}
		} else if (ch === "?") {
			regexStr += ".";
		} else if (/[.+{}()|[\]\\]/.test(ch)) {
			regexStr += `\\${ch}`;
		} else {
			regexStr += ch;
		}
	}
	regexStr += "$";
	return new RegExp(regexStr).test(input);
}

export class PermissionEngine {
	private log = new Logger("permissions");
	private rules: PermissionRule[] = [];
	private auditDir: string;
	private askHandler?: (
		request: PermissionRequest,
	) => Promise<PermissionDecision>;

	constructor(workspaceDir: string) {
		this.auditDir = join(workspaceDir, ".security");
		mkdirSync(this.auditDir, { recursive: true });
		// Default deny-all rule
		this.addRule({
			id: "default-deny",
			pattern: "*",
			decision: "deny",
			priority: 9999,
			description: "Default deny-all rule",
			createdAt: new Date().toISOString(),
		});
	}

	/** Add a permission rule */
	addRule(rule: PermissionRule): void {
		this.rules.push(rule);
		// Keep sorted by priority
		this.rules.sort((a, b) => a.priority - b.priority);
		this.log.info(
			`Rule added: ${rule.pattern} → ${rule.decision} (priority ${rule.priority})`,
		);
	}

	/** Remove a rule by ID */
	removeRule(id: string): boolean {
		const idx = this.rules.findIndex((r) => r.id === id);
		if (idx === -1) return false;
		this.rules.splice(idx, 1);
		return true;
	}

	/** List all rules */
	listRules(): PermissionRule[] {
		return [...this.rules];
	}

	/** Set a handler for "ask" decisions */
	setAskHandler(
		handler: (request: PermissionRequest) => Promise<PermissionDecision>,
	): void {
		this.askHandler = handler;
	}

	/**
	 * Check a permission request.
	 * Returns the decision based on the first matching rule.
	 */
	async check(
		subject: string,
		context?: Record<string, unknown>,
	): Promise<PermissionResult> {
		const request: PermissionRequest = {
			subject,
			context,
			timestamp: new Date().toISOString(),
		};

		// Find first matching rule
		let matchedRule: PermissionRule | undefined;
		for (const rule of this.rules) {
			if (matchesGlob(rule.pattern, subject)) {
				matchedRule = rule;
				break;
			}
		}

		let decision: PermissionDecision = "deny"; // fallback

		if (matchedRule) {
			if (matchedRule.decision === "ask") {
				if (this.askHandler) {
					decision = await this.askHandler(request);
				} else {
					decision = "deny"; // No handler → deny
				}
			} else {
				decision = matchedRule.decision;
			}
		}

		const result: PermissionResult = {
			request,
			decision,
			matchedRule,
			evaluatedAt: new Date().toISOString(),
		};

		this.audit(result);
		return result;
	}

	/** Synchronous check (for non-ask decisions) */
	checkSync(
		subject: string,
		context?: Record<string, unknown>,
	): PermissionResult {
		const request: PermissionRequest = {
			subject,
			context,
			timestamp: new Date().toISOString(),
		};

		let matchedRule: PermissionRule | undefined;
		for (const rule of this.rules) {
			if (matchesGlob(rule.pattern, subject)) {
				matchedRule = rule;
				break;
			}
		}

		const decision: PermissionDecision =
			matchedRule?.decision === "allow" ? "allow" : "deny";
		// Note: "ask" is treated as "deny" in sync mode since we can't prompt

		const result: PermissionResult = {
			request,
			decision,
			matchedRule,
			evaluatedAt: new Date().toISOString(),
		};

		this.audit(result);
		return result;
	}

	/** Check if a subject is allowed (convenience) */
	isAllowed(subject: string): boolean {
		return this.checkSync(subject).decision === "allow";
	}

	/** Reset all rules (keeps default deny) */
	reset(): void {
		this.rules = this.rules.filter((r) => r.id === "default-deny");
	}

	// ============================================================
	// Private
	// ============================================================

	private audit(result: PermissionResult): void {
		const today = new Date().toISOString().slice(0, 10);
		const filePath = join(this.auditDir, `permissions-${today}.jsonl`);
		appendFileSync(filePath, `${JSON.stringify(result)}\n`, "utf-8");

		if (result.decision === "deny") {
			this.log.warn(`Permission denied: ${result.request.subject}`);
		}
	}
}
