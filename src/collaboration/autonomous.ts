/**
 * Autonomous Task Claiming
 *
 * Enables agents to autonomously claim and execute tasks from a shared
 * task board. Inspired by Hermes' autonomous task management.
 *
 * Architecture:
 *   - Task board: JSONL file shared across agents
 *   - Claim mechanism: atomic write (tmp + rename) prevents double-claiming
 *   - Priority: tasks have priorities; agents claim highest-priority first
 *   - Heartbeat: agents periodically update task progress
 *   - Timeout: unclaimed tasks can be re-claimed after timeout
 *
 * Design principles:
 *   - At-most-once execution: atomic claim prevents duplicates
 *   - Fair distribution: agents track their workload
 *   - Transparent: task board is human-readable JSONL
 */

import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { Logger } from "../observability/logger.js";

export type TaskPriority = "critical" | "high" | "medium" | "low";
export type TaskStatus =
	| "pending"
	| "claimed"
	| "in_progress"
	| "completed"
	| "failed"
	| "timeout";

export interface Task {
	id: string;
	title: string;
	description: string;
	priority: TaskPriority;
	status: TaskStatus;
	claimedBy?: string;
	claimedAt?: string;
	completedAt?: string;
	progress?: string;
	result?: string;
	error?: string;
	createdAt: string;
	timeoutMs: number;
	tags: string[];
}

export interface AgentWorkload {
	agentName: string;
	activeTasks: number;
	completedTasks: number;
	failedTasks: number;
	lastHeartbeat: string;
}

export class TaskBoard {
	private log = new Logger("task-board");
	private boardDir: string;
	private boardFile: string;

	constructor(workspaceDir: string) {
		this.boardDir = join(workspaceDir, ".tasks");
		this.boardFile = join(this.boardDir, "board.jsonl");
		mkdirSync(this.boardDir, { recursive: true });
	}

	/**
	 * Add a new task to the board.
	 */
	addTask(task: Omit<Task, "id" | "status" | "createdAt">): Task {
		const fullTask: Task = {
			...task,
			id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
			status: "pending",
			createdAt: new Date().toISOString(),
		};

		appendFileSync(this.boardFile, `${JSON.stringify(fullTask)}\n`, "utf-8");
		this.log.info(`Task added: ${fullTask.id} (${fullTask.priority})`);
		return fullTask;
	}

	/**
	 * Claim a task atomically.
	 * Returns the claimed task, or null if already claimed.
	 */
	claimTask(taskId: string, agentName: string): Task | null {
		const tasks = this.readAll();
		const task = tasks.find((t) => t.id === taskId);

		if (!task) return null;

		// Check for timeout on previously claimed tasks
		if (task.status === "claimed" && task.claimedAt) {
			const elapsed = Date.now() - new Date(task.claimedAt).getTime();
			if (elapsed < task.timeoutMs) return null; // Still within timeout
			// Timed out, fall through to re-claim
		} else if (task.status !== "pending") {
			return null;
		}

		task.status = "claimed";
		task.claimedBy = agentName;
		task.claimedAt = new Date().toISOString();

		this.writeAll(tasks);
		this.log.info(`Task claimed: ${taskId} by ${agentName}`);
		return task;
	}

	/**
	 * Claim the highest-priority pending task.
	 */
	claimNext(agentName: string): Task | null {
		const pending = this.readAll()
			.filter((t) => t.status === "pending" || this.isTimedOut(t))
			.sort((a, b) => {
				const prio: Record<TaskPriority, number> = {
					critical: 0,
					high: 1,
					medium: 2,
					low: 3,
				};
				return prio[a.priority] - prio[b.priority];
			});

		if (pending.length === 0) return null;
		return this.claimTask(pending[0].id, agentName);
	}

	/**
	 * Update task progress.
	 */
	updateProgress(taskId: string, progress: string): boolean {
		const tasks = this.readAll();
		const task = tasks.find((t) => t.id === taskId);
		if (!task) return false;

		task.progress = progress;
		if (task.status === "claimed") {
			task.status = "in_progress";
		}

		this.writeAll(tasks);
		return true;
	}

	/**
	 * Complete a task.
	 */
	completeTask(taskId: string, result: string): boolean {
		const tasks = this.readAll();
		const task = tasks.find((t) => t.id === taskId);
		if (!task || !["claimed", "in_progress"].includes(task.status))
			return false;

		task.status = "completed";
		task.result = result;
		task.completedAt = new Date().toISOString();

		this.writeAll(tasks);
		this.log.info(`Task completed: ${taskId}`);
		return true;
	}

	/**
	 * Mark a task as failed.
	 */
	failTask(taskId: string, error: string): boolean {
		const tasks = this.readAll();
		const task = tasks.find((t) => t.id === taskId);
		if (!task) return false;

		task.status = "failed";
		task.error = error;

		this.writeAll(tasks);
		this.log.warn(`Task failed: ${taskId} — ${error}`);
		return true;
	}

	/**
	 * Release a claim (make task pending again).
	 */
	releaseTask(taskId: string): boolean {
		const tasks = this.readAll();
		const task = tasks.find((t) => t.id === taskId);
		if (!task || task.status !== "claimed") return false;

		task.status = "pending";
		task.claimedBy = undefined;
		task.claimedAt = undefined;

		this.writeAll(tasks);
		this.log.info(`Task released: ${taskId}`);
		return true;
	}

	/**
	 * Get agent workload statistics.
	 */
	getWorkload(agentName: string): AgentWorkload {
		const tasks = this.readAll();
		const agentTasks = tasks.filter((t) => t.claimedBy === agentName);

		return {
			agentName,
			activeTasks: agentTasks.filter((t) =>
				["claimed", "in_progress"].includes(t.status),
			).length,
			completedTasks: agentTasks.filter((t) => t.status === "completed").length,
			failedTasks: agentTasks.filter((t) => t.status === "failed").length,
			lastHeartbeat: new Date().toISOString(),
		};
	}

	/** List all tasks */
	listTasks(status?: TaskStatus): Task[] {
		const tasks = this.readAll();
		if (status) return tasks.filter((t) => t.status === status);
		return tasks;
	}

	/** Get board statistics */
	getStats(): Record<TaskStatus, number> {
		const tasks = this.readAll();
		const stats: Record<TaskStatus, number> = {
			pending: 0,
			claimed: 0,
			in_progress: 0,
			completed: 0,
			failed: 0,
			timeout: 0,
		};
		for (const task of tasks) {
			stats[task.status]++;
		}
		return stats;
	}

	// ============================================================
	// Private
	// ============================================================

	private readAll(): Task[] {
		if (!existsSync(this.boardFile)) return [];
		const content = readFileSync(this.boardFile, "utf-8");
		const tasks: Task[] = [];
		for (const line of content.split("\n")) {
			if (line.trim()) {
				try {
					tasks.push(JSON.parse(line));
				} catch {
					// skip
				}
			}
		}
		return tasks;
	}

	private writeAll(tasks: Task[]): void {
		const tmpPath = `${this.boardFile}.tmp`;
		writeFileSync(
			tmpPath,
			`${tasks.map((t) => JSON.stringify(t)).join("\n")}\n`,
			"utf-8",
		);
		renameSync(tmpPath, this.boardFile);
	}

	private isTimedOut(task: Task): boolean {
		if (task.status !== "claimed" || !task.claimedAt) return false;
		const elapsed = Date.now() - new Date(task.claimedAt).getTime();
		return elapsed > task.timeoutMs;
	}
}
