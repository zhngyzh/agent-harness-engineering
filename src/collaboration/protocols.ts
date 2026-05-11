/**
 * Collaboration Protocols
 *
 * Implements structured communication protocols for agent coordination:
 *
 *   1. Shutdown Protocol — graceful shutdown handshake
 *      - Initiator sends shutdown_request with request_id
 *      - Responder acknowledges with shutdown_response
 *      - Timeout: if no response in 30s, force shutdown
 *
 *   2. Plan Approval Protocol — plan gate FSM
 *      - Agent submits plan → waits for approval/rejection
 *      - States: pending → approved | rejected | timeout
 *      - Approved plans can be executed; rejected plans trigger revision
 *
 *   3. Task Handoff Protocol — structured task transfer
 *      - Includes context summary, progress, next steps
 *      - Acknowledgment required
 *
 * Design (from learn-claude-code s09-s10):
 *   - Protocols are message-driven (via TeamMailbox)
 *   - request_id correlation for matching requests/responses
 *   - FSM for state tracking with timeout handling
 */

import { Logger } from "../observability/logger.js";
import type { TeamMailbox, TeamMessage } from "./team.js";

export type ShutdownState =
	| "idle"
	| "requested"
	| "acknowledged"
	| "force"
	| "complete";
export type PlanState =
	| "draft"
	| "pending"
	| "approved"
	| "rejected"
	| "timeout"
	| "executing"
	| "done";
export type HandoffState = "idle" | "transferring" | "acknowledged" | "failed";

export interface ProtocolConfig {
	shutdownTimeoutMs: number;
	planTimeoutMs: number;
	handoffTimeoutMs: number;
}

export const DEFAULT_PROTOCOL_CONFIG: ProtocolConfig = {
	shutdownTimeoutMs: 30_000,
	planTimeoutMs: 120_000,
	handoffTimeoutMs: 60_000,
};

// ============================================================
// Shutdown Protocol
// ============================================================

export interface ShutdownSession {
	requestId: string;
	from: string;
	to: string;
	state: ShutdownState;
	requestedAt: string;
	respondedAt?: string;
	reason?: string;
}

export class ShutdownProtocol {
	private log = new Logger("shutdown-protocol");
	private sessions = new Map<string, ShutdownSession>();
	private timers = new Map<string, ReturnType<typeof setTimeout>>();
	private counter = 0;

	constructor(
		private mailbox: TeamMailbox,
		private config: ProtocolConfig,
		private onShutdown: (session: ShutdownSession) => Promise<void>,
	) {}

	/**
	 * Initiate a graceful shutdown.
	 */
	async initiate(
		from: string,
		to: string,
		reason?: string,
	): Promise<ShutdownSession> {
		const requestId = `shutdown-${Date.now()}-${++this.counter}`;
		const session: ShutdownSession = {
			requestId,
			from,
			to,
			state: "requested",
			requestedAt: new Date().toISOString(),
			reason,
		};

		this.sessions.set(requestId, session);

		this.mailbox.send({
			type: "shutdown_request",
			from,
			to,
			content: reason || "Graceful shutdown requested",
			request_id: requestId,
		});

		this.log.info(`Shutdown requested: ${from} -> ${to} (${requestId})`);

		// Set timeout
		this.timers.set(
			requestId,
			setTimeout(
				() => this.handleTimeout(requestId),
				this.config.shutdownTimeoutMs,
			),
		);

		return session;
	}

	/**
	 * Handle an incoming shutdown request.
	 */
	handleRequest(message: TeamMessage): ShutdownSession {
		const session: ShutdownSession = {
			requestId: message.request_id || `shutdown-${Date.now()}`,
			from: message.from,
			to: message.to,
			state: "requested",
			requestedAt: message.timestamp,
			reason: message.content,
		};

		this.sessions.set(session.requestId, session);
		this.log.info(`Shutdown request received: ${session.requestId}`);
		return session;
	}

	/**
	 * Acknowledge a shutdown request.
	 */
	respond(requestId: string): boolean {
		const session = this.sessions.get(requestId);
		if (!session || session.state !== "requested") return false;

		session.state = "acknowledged";
		session.respondedAt = new Date().toISOString();

		this.mailbox.send({
			type: "shutdown_response",
			from: session.to,
			to: session.from,
			content: "Shutdown acknowledged",
			request_id: requestId,
		});

		// Cancel timeout
		const timer = this.timers.get(requestId);
		if (timer) {
			clearTimeout(timer);
			this.timers.delete(requestId);
		}

		this.log.info(`Shutdown acknowledged: ${requestId}`);

		// Execute shutdown callback
		this.onShutdown(session);

		return true;
	}

	/** Get session by request_id */
	getSession(requestId: string): ShutdownSession | undefined {
		return this.sessions.get(requestId);
	}

	/** List all shutdown sessions */
	listSessions(): ShutdownSession[] {
		return Array.from(this.sessions.values());
	}

	private handleTimeout(requestId: string): void {
		const session = this.sessions.get(requestId);
		if (!session || session.state !== "requested") return;

		session.state = "force";
		this.timers.delete(requestId);
		this.log.warn(`Shutdown timeout — forcing: ${requestId}`);
		this.onShutdown(session);
	}
}

// ============================================================
// Plan Approval Protocol
// ============================================================

export interface PlanSession {
	requestId: string;
	submittedBy: string;
	plan: string;
	state: PlanState;
	submittedAt: string;
	respondedAt?: string;
	response?: string; // approver's comment
	maxRevisions: number;
	revisionCount: number;
}

export class PlanApprovalProtocol {
	private log = new Logger("plan-protocol");
	private sessions = new Map<string, PlanSession>();
	private timers = new Map<string, ReturnType<typeof setTimeout>>();
	private counter = 0;

	constructor(
		private mailbox: TeamMailbox,
		private config: ProtocolConfig = DEFAULT_PROTOCOL_CONFIG,
		private onPlanApproved?: (session: PlanSession) => void,
		private onPlanRejected?: (session: PlanSession) => void,
	) {}

	/**
	 * Submit a plan for approval.
	 */
	submit(submittedBy: string, plan: string, approver: string): PlanSession {
		const requestId = `plan-${Date.now()}-${++this.counter}`;
		const session: PlanSession = {
			requestId,
			submittedBy,
			plan,
			state: "pending",
			submittedAt: new Date().toISOString(),
			maxRevisions: 3,
			revisionCount: 0,
		};

		this.sessions.set(requestId, session);

		this.mailbox.send({
			type: "message",
			from: submittedBy,
			to: approver,
			content: `Plan submitted for approval:\n\n${plan}\n\nRequest ID: ${requestId}`,
			request_id: requestId,
		});

		// Set timeout
		this.timers.set(
			requestId,
			setTimeout(
				() => this.handleTimeout(requestId),
				this.config.planTimeoutMs,
			),
		);

		this.log.info(`Plan submitted: ${requestId}`);
		return session;
	}

	/**
	 * Approve a plan.
	 */
	approve(requestId: string, comment?: string): boolean {
		const session = this.sessions.get(requestId);
		if (!session || session.state !== "pending") return false;

		session.state = "approved";
		session.respondedAt = new Date().toISOString();
		session.response = comment;

		this.clearTimer(requestId);

		this.mailbox.send({
			type: "plan_approval_response",
			from: "approver",
			to: session.submittedBy,
			content: comment || "Plan approved",
			request_id: requestId,
		});

		this.log.info(`Plan approved: ${requestId}`);
		this.onPlanApproved?.(session);
		return true;
	}

	/**
	 * Reject a plan.
	 */
	reject(requestId: string, comment?: string): boolean {
		const session = this.sessions.get(requestId);
		if (!session || (session.state !== "pending" && session.state !== "draft"))
			return false;

		session.revisionCount++;
		if (session.revisionCount >= session.maxRevisions) {
			session.state = "rejected";
			this.clearTimer(requestId);
			this.log.warn(`Plan rejected (max revisions): ${requestId}`);
			this.onPlanRejected?.(session);
		} else {
			session.state = "pending"; // back to pending for re-submission
			this.log.info(
				`Plan returned for revision (${session.revisionCount}/${session.maxRevisions}): ${requestId}`,
			);
		}

		session.respondedAt = new Date().toISOString();
		session.response = comment;

		this.mailbox.send({
			type: "plan_approval_response",
			from: "approver",
			to: session.submittedBy,
			content: comment || "Plan rejected",
			request_id: requestId,
		});

		return true;
	}

	/** Get session */
	getSession(requestId: string): PlanSession | undefined {
		return this.sessions.get(requestId);
	}

	/** List all sessions */
	listSessions(): PlanSession[] {
		return Array.from(this.sessions.values());
	}

	private handleTimeout(requestId: string): void {
		const session = this.sessions.get(requestId);
		if (!session || session.state !== "pending") return;

		session.state = "timeout";
		this.log.warn(`Plan approval timeout: ${requestId}`);
		this.onPlanRejected?.(session);
	}

	private clearTimer(requestId: string): void {
		const timer = this.timers.get(requestId);
		if (timer) {
			clearTimeout(timer);
			this.timers.delete(requestId);
		}
	}
}

// ============================================================
// Task Handoff Protocol
// ============================================================

export interface HandoffSession {
	requestId: string;
	from: string;
	to: string;
	taskDescription: string;
	contextSummary: string;
	progress: string;
	nextSteps: string[];
	state: HandoffState;
	createdAt: string;
	acknowledgedAt?: string;
}

export class TaskHandoffProtocol {
	private log = new Logger("handoff-protocol");
	private sessions = new Map<string, HandoffSession>();
	private timers = new Map<string, ReturnType<typeof setTimeout>>();
	private counter = 0;

	constructor(
		private mailbox: TeamMailbox,
		private config: ProtocolConfig = DEFAULT_PROTOCOL_CONFIG,
	) {}

	/**
	 * Initiate a task handoff.
	 */
	initiate(
		from: string,
		to: string,
		taskDescription: string,
		contextSummary: string,
		progress: string,
		nextSteps: string[],
	): HandoffSession {
		const requestId = `handoff-${Date.now()}-${++this.counter}`;
		const session: HandoffSession = {
			requestId,
			from,
			to,
			taskDescription,
			contextSummary,
			progress,
			nextSteps,
			state: "transferring",
			createdAt: new Date().toISOString(),
		};

		this.sessions.set(requestId, session);

		this.mailbox.send({
			type: "message",
			from,
			to,
			content: this.formatHandoffMessage(session),
			request_id: requestId,
		});

		this.timers.set(
			requestId,
			setTimeout(
				() => this.handleTimeout(requestId),
				this.config.handoffTimeoutMs,
			),
		);

		this.log.info(`Handoff initiated: ${from} -> ${to} (${requestId})`);
		return session;
	}

	/**
	 * Acknowledge a handoff.
	 */
	acknowledge(requestId: string): boolean {
		const session = this.sessions.get(requestId);
		if (!session || session.state !== "transferring") return false;

		session.state = "acknowledged";
		session.acknowledgedAt = new Date().toISOString();

		const timer = this.timers.get(requestId);
		if (timer) {
			clearTimeout(timer);
			this.timers.delete(requestId);
		}

		this.mailbox.send({
			type: "message",
			from: session.to,
			to: session.from,
			content: `Handoff acknowledged: ${session.taskDescription}`,
			request_id: requestId,
		});

		this.log.info(`Handoff acknowledged: ${requestId}`);
		return true;
	}

	getSession(requestId: string): HandoffSession | undefined {
		return this.sessions.get(requestId);
	}

	listSessions(): HandoffSession[] {
		return Array.from(this.sessions.values());
	}

	private handleTimeout(requestId: string): void {
		const session = this.sessions.get(requestId);
		if (!session || session.state !== "transferring") return;

		session.state = "failed";
		this.log.warn(`Handoff timeout: ${requestId}`);
	}

	private formatHandoffMessage(session: HandoffSession): string {
		return `## Task Handoff

**Task:** ${session.taskDescription}

**Progress:** ${session.progress}

**Context:**
${session.contextSummary}

**Next Steps:**
${session.nextSteps.map((s, i) => `${i + 1}. ${s}`).join("\n")}

Please acknowledge this handoff. Request ID: ${session.requestId}`;
	}
}
