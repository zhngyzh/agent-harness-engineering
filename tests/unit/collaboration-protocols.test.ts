import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskBoard } from "../../src/collaboration/autonomous.js";
import {
	DEFAULT_PROTOCOL_CONFIG,
	PlanApprovalProtocol,
	ShutdownProtocol,
	TaskHandoffProtocol,
} from "../../src/collaboration/protocols.js";
import { TeamMailbox } from "../../src/collaboration/team.js";

const TEST_DIR = join(import.meta.dirname, "..", "..", ".test-protocols");

// ============================================================
// ShutdownProtocol
// ============================================================

describe("ShutdownProtocol", () => {
	let mailbox: TeamMailbox;
	let protocol: ShutdownProtocol;
	let shutdownHandler: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		rmSync(TEST_DIR, { recursive: true, force: true });
		mkdirSync(TEST_DIR, { recursive: true });
		mailbox = new TeamMailbox(TEST_DIR);
		mailbox.init();
		shutdownHandler = vi.fn();
		protocol = new ShutdownProtocol(
			mailbox,
			DEFAULT_PROTOCOL_CONFIG,
			shutdownHandler,
		);
	});

	afterEach(() => {
		rmSync(TEST_DIR, { recursive: true, force: true });
	});

	it("initiates shutdown and sends request", async () => {
		const session = await protocol.initiate("alice", "bob", "Going offline");
		expect(session.state).toBe("requested");
		expect(session.from).toBe("alice");
		expect(session.to).toBe("bob");
		expect(session.requestId).toBeDefined();
	});

	it("responds to shutdown request", () => {
		protocol.handleRequest({
			id: "msg-1",
			type: "shutdown_request",
			from: "alice",
			to: "bob",
			content: "Going offline",
			request_id: "shutdown-001",
			timestamp: new Date().toISOString(),
			read: false,
		});

		const result = protocol.respond("shutdown-001");
		expect(result).toBe(true);

		const session = protocol.getSession("shutdown-001");
		expect(session?.state).toBe("acknowledged");
	});

	it("respond returns false for unknown request", () => {
		expect(protocol.respond("nonexistent")).toBe(false);
	});

	it("lists all sessions", () => {
		protocol.handleRequest({
			id: "msg-1",
			type: "shutdown_request",
			from: "a",
			to: "b",
			content: "test",
			request_id: "s1",
			timestamp: new Date().toISOString(),
			read: false,
		});
		protocol.handleRequest({
			id: "msg-2",
			type: "shutdown_request",
			from: "c",
			to: "d",
			content: "test",
			request_id: "s2",
			timestamp: new Date().toISOString(),
			read: false,
		});
		expect(protocol.listSessions().length).toBe(2);
	});
});

// ============================================================
// PlanApprovalProtocol
// ============================================================

describe("PlanApprovalProtocol", () => {
	let mailbox: TeamMailbox;
	let protocol: PlanApprovalProtocol;

	beforeEach(() => {
		rmSync(TEST_DIR, { recursive: true, force: true });
		mkdirSync(TEST_DIR, { recursive: true });
		mailbox = new TeamMailbox(TEST_DIR);
		mailbox.init();
		protocol = new PlanApprovalProtocol(mailbox, DEFAULT_PROTOCOL_CONFIG);
	});

	afterEach(() => {
		rmSync(TEST_DIR, { recursive: true, force: true });
	});

	it("submits a plan for approval", () => {
		const session = protocol.submit(
			"agent-1",
			"Step 1: Do X\nStep 2: Do Y",
			"reviewer",
		);
		expect(session.state).toBe("pending");
		expect(session.plan).toContain("Step 1");
		expect(session.submittedBy).toBe("agent-1");
	});

	it("approves a plan", () => {
		const session = protocol.submit("agent-1", "Plan A", "reviewer");
		const result = protocol.approve(session.requestId, "Looks good");
		expect(result).toBe(true);

		const updated = protocol.getSession(session.requestId);
		expect(updated?.state).toBe("approved");
		expect(updated?.response).toBe("Looks good");
	});

	it("rejects a plan", () => {
		const session = protocol.submit("agent-1", "Plan A", "reviewer");
		const result = protocol.reject(session.requestId, "Needs more detail");
		expect(result).toBe(true);

		const updated = protocol.getSession(session.requestId);
		expect(updated?.state).toBe("pending"); // Back to pending for revision
		expect(updated?.revisionCount).toBe(1);
	});

	it("rejects after max revisions", () => {
		const session = protocol.submit("agent-1", "Plan A", "reviewer");

		// Reject 3 times (max)
		protocol.reject(session.requestId);
		protocol.reject(session.requestId);
		const result = protocol.reject(session.requestId);

		expect(result).toBe(true);
		const updated = protocol.getSession(session.requestId);
		expect(updated?.state).toBe("rejected");
	});

	it("approve returns false for unknown plan", () => {
		expect(protocol.approve("nonexistent")).toBe(false);
	});

	it("lists all sessions", () => {
		protocol.submit("a1", "Plan 1", "r1");
		protocol.submit("a2", "Plan 2", "r2");
		expect(protocol.listSessions().length).toBe(2);
	});

	it("calls onPlanApproved callback", () => {
		const onApproved = vi.fn();
		const onRejected = vi.fn();
		const p = new PlanApprovalProtocol(
			mailbox,
			DEFAULT_PROTOCOL_CONFIG,
			onApproved,
			onRejected,
		);

		const session = p.submit("agent", "Plan", "reviewer");
		p.approve(session.requestId);

		expect(onApproved).toHaveBeenCalled();
		expect(onRejected).not.toHaveBeenCalled();
	});
});

// ============================================================
// TaskHandoffProtocol
// ============================================================

describe("TaskHandoffProtocol", () => {
	let mailbox: TeamMailbox;
	let protocol: TaskHandoffProtocol;

	beforeEach(() => {
		rmSync(TEST_DIR, { recursive: true, force: true });
		mkdirSync(TEST_DIR, { recursive: true });
		mailbox = new TeamMailbox(TEST_DIR);
		mailbox.init();
		protocol = new TaskHandoffProtocol(mailbox, DEFAULT_PROTOCOL_CONFIG);
	});

	afterEach(() => {
		rmSync(TEST_DIR, { recursive: true, force: true });
	});

	it("initiates a handoff", () => {
		const session = protocol.initiate(
			"alice",
			"bob",
			"Implement feature X",
			"Context: existing codebase uses TypeScript",
			"50% done — core logic written",
			["Write tests", "Update docs", "PR review"],
		);

		expect(session.state).toBe("transferring");
		expect(session.from).toBe("alice");
		expect(session.to).toBe("bob");
		expect(session.nextSteps.length).toBe(3);
	});

	it("acknowledges a handoff", () => {
		const session = protocol.initiate("alice", "bob", "Task", "ctx", "0%", [
			"step 1",
		]);
		const result = protocol.acknowledge(session.requestId);
		expect(result).toBe(true);

		const updated = protocol.getSession(session.requestId);
		expect(updated?.state).toBe("acknowledged");
		expect(updated?.acknowledgedAt).toBeDefined();
	});

	it("acknowledge returns false for unknown handoff", () => {
		expect(protocol.acknowledge("nonexistent")).toBe(false);
	});

	it("lists all sessions", () => {
		protocol.initiate("a", "b", "T1", "c", "p", ["s"]);
		protocol.initiate("c", "d", "T2", "c", "p", ["s"]);
		expect(protocol.listSessions().length).toBe(2);
	});
});

// ============================================================
// TaskBoard (Autonomous)
// ============================================================

describe("TaskBoard", () => {
	let board: TaskBoard;

	beforeEach(() => {
		rmSync(TEST_DIR, { recursive: true, force: true });
		mkdirSync(TEST_DIR, { recursive: true });
		board = new TaskBoard(TEST_DIR);
	});

	afterEach(() => {
		rmSync(TEST_DIR, { recursive: true, force: true });
	});

	it("adds a task", () => {
		const task = board.addTask({
			title: "Fix bug #42",
			description: "The login flow is broken",
			priority: "high",
			timeoutMs: 60_000,
			tags: ["bug", "auth"],
		});

		expect(task.id).toBeDefined();
		expect(task.status).toBe("pending");
		expect(task.priority).toBe("high");
		expect(task.createdAt).toBeDefined();
	});

	it("claims a task", () => {
		const task = board.addTask({
			title: "Task 1",
			description: "desc",
			priority: "medium",
			timeoutMs: 60_000,
			tags: [],
		});

		const claimed = board.claimTask(task.id, "agent-1");
		expect(claimed).not.toBeNull();
		expect(claimed?.status).toBe("claimed");
		expect(claimed?.claimedBy).toBe("agent-1");
	});

	it("cannot claim already claimed task", () => {
		const task = board.addTask({
			title: "Task 1",
			description: "desc",
			priority: "medium",
			timeoutMs: 60_000,
			tags: [],
		});

		board.claimTask(task.id, "agent-1");
		const second = board.claimTask(task.id, "agent-2");
		expect(second).toBeNull();
	});

	it("claims highest-priority pending task", () => {
		board.addTask({
			title: "Low",
			description: "d",
			priority: "low",
			timeoutMs: 60_000,
			tags: [],
		});
		board.addTask({
			title: "Critical",
			description: "d",
			priority: "critical",
			timeoutMs: 60_000,
			tags: [],
		});
		board.addTask({
			title: "High",
			description: "d",
			priority: "high",
			timeoutMs: 60_000,
			tags: [],
		});

		const claimed = board.claimNext("agent-1");
		expect(claimed).not.toBeNull();
		expect(claimed?.priority).toBe("critical");
	});

	it("returns null when no pending tasks", () => {
		expect(board.claimNext("agent-1")).toBeNull();
	});

	it("updates progress", () => {
		const task = board.addTask({
			title: "Task",
			description: "d",
			priority: "medium",
			timeoutMs: 60_000,
			tags: [],
		});
		board.claimTask(task.id, "agent-1");

		const result = board.updateProgress(task.id, "50% complete");
		expect(result).toBe(true);

		const tasks = board.listTasks();
		expect(tasks[0].progress).toBe("50% complete");
		expect(tasks[0].status).toBe("in_progress");
	});

	it("completes a task", () => {
		const task = board.addTask({
			title: "Task",
			description: "d",
			priority: "medium",
			timeoutMs: 60_000,
			tags: [],
		});
		board.claimTask(task.id, "agent-1");

		const result = board.completeTask(task.id, "Done!");
		expect(result).toBe(true);

		const tasks = board.listTasks();
		expect(tasks[0].status).toBe("completed");
		expect(tasks[0].result).toBe("Done!");
		expect(tasks[0].completedAt).toBeDefined();
	});

	it("completes returns false for pending task", () => {
		const task = board.addTask({
			title: "Task",
			description: "d",
			priority: "medium",
			timeoutMs: 60_000,
			tags: [],
		});
		expect(board.completeTask(task.id, "result")).toBe(false);
	});

	it("fails a task", () => {
		const task = board.addTask({
			title: "Task",
			description: "d",
			priority: "medium",
			timeoutMs: 60_000,
			tags: [],
		});
		board.claimTask(task.id, "agent-1");

		const result = board.failTask(task.id, "Out of memory");
		expect(result).toBe(true);

		const tasks = board.listTasks();
		expect(tasks[0].status).toBe("failed");
		expect(tasks[0].error).toBe("Out of memory");
	});

	it("releases a claimed task", () => {
		const task = board.addTask({
			title: "Task",
			description: "d",
			priority: "medium",
			timeoutMs: 60_000,
			tags: [],
		});
		board.claimTask(task.id, "agent-1");

		const result = board.releaseTask(task.id);
		expect(result).toBe(true);

		const tasks = board.listTasks();
		expect(tasks[0].status).toBe("pending");
		expect(tasks[0].claimedBy).toBeUndefined();
	});

	it("gets agent workload", () => {
		const t1 = board.addTask({
			title: "T1",
			description: "d",
			priority: "high",
			timeoutMs: 60_000,
			tags: [],
		});
		const t2 = board.addTask({
			title: "T2",
			description: "d",
			priority: "low",
			timeoutMs: 60_000,
			tags: [],
		});
		board.claimTask(t1.id, "agent-1");
		board.claimTask(t2.id, "agent-1");
		board.completeTask(t1.id, "done");

		const workload = board.getWorkload("agent-1");
		expect(workload.activeTasks).toBe(1);
		expect(workload.completedTasks).toBe(1);
		expect(workload.agentName).toBe("agent-1");
	});

	it("lists tasks filtered by status", () => {
		const t1 = board.addTask({
			title: "T1",
			description: "d",
			priority: "high",
			timeoutMs: 60_000,
			tags: [],
		});
		board.addTask({
			title: "T2",
			description: "d",
			priority: "low",
			timeoutMs: 60_000,
			tags: [],
		});
		board.claimTask(t1.id, "agent-1");

		expect(board.listTasks("pending").length).toBe(1);
		expect(board.listTasks("claimed").length).toBe(1);
	});

	it("gets board statistics", () => {
		const t1 = board.addTask({
			title: "T1",
			description: "d",
			priority: "high",
			timeoutMs: 60_000,
			tags: [],
		});
		board.addTask({
			title: "T2",
			description: "d",
			priority: "low",
			timeoutMs: 60_000,
			tags: [],
		});
		board.claimTask(t1.id, "agent-1");

		const stats = board.getStats();
		expect(stats.pending).toBe(1);
		expect(stats.claimed).toBe(1);
	});

	it("claimNext returns null for empty board", () => {
		expect(board.claimNext("agent")).toBeNull();
	});
});
