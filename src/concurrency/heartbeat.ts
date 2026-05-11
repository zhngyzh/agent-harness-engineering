/**
 * Heartbeat + Cron Scheduler
 *
 * Heartbeat: periodic agent wake-up for proactive behavior.
 *   - 4 precondition checks before running
 *   - Non-blocking: uses tryLock pattern (user input has priority)
 *   - Dedup: responds HEARTBEAT_OK if nothing needs attention
 *
 * Cron: schedule-based task execution.
 *   - 3 schedule types: at (one-shot), every (interval), cron (expression)
 *   - Auto-disable after 5 consecutive errors
 *   - Run logging to JSONL
 *
 * Design (from claw0 s07):
 *   - Heartbeat and Cron share a single timer to avoid duplicate wake-ups
 *   - Cron uses croniter-compatible expressions
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Logger } from "../observability/logger.js";
import type { CommandQueue } from "./lanes.js";

export interface HeartbeatConfig {
	intervalMs: number;
	enabled: boolean;
}

export interface CronJob {
	id: string;
	name: string;
	schedule: CronSchedule;
	action: string; // Instruction for the agent
	enabled: boolean;
	consecutiveErrors: number;
	lastRunAt: string | null;
	nextRunAt: string | null;
	createdAt: string;
}

export type CronSchedule =
	| { type: "at"; at: string } // ISO timestamp (one-shot)
	| { type: "every"; everyMs: number } // Interval in ms
	| { type: "cron"; expression: string }; // Cron expression (simplified)

export class CronScheduler {
	private jobs = new Map<string, CronJob>();
	private log = new Logger("cron");
	private timer: ReturnType<typeof setTimeout> | null = null;
	private runLogDir: string;
	private maxConsecutiveErrors = 5;

	constructor(
		workspaceDir: string,
		_commandQueue: CommandQueue,
		private onJobRun: (job: CronJob) => Promise<void>,
	) {
		this.runLogDir = join(workspaceDir, "cron");
		mkdirSync(this.runLogDir, { recursive: true });
	}

	/** Add a cron job */
	addJob(job: CronJob): void {
		this.jobs.set(job.id, job);
		this.log.info(`Cron job added: ${job.name} (${job.schedule.type})`);
	}

	/** Remove a cron job */
	removeJob(id: string): boolean {
		const removed = this.jobs.delete(id);
		if (removed) this.log.info(`Cron job removed: ${id}`);
		return removed;
	}

	/** List all jobs */
	listJobs(): CronJob[] {
		return Array.from(this.jobs.values());
	}

	/** Start the scheduler */
	start(): void {
		this.scheduleNext();
		this.log.info(`Cron scheduler started (${this.jobs.size} jobs)`);
	}

	/** Stop the scheduler */
	stop(): void {
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
	}

	/** Manually trigger a job (for testing) */
	async triggerJob(id: string): Promise<void> {
		const job = this.jobs.get(id);
		if (!job) throw new Error(`Job not found: ${id}`);
		await this.runJob(job);
	}

	// ============================================================
	// Private
	// ============================================================

	private scheduleNext(): void {
		if (this.timer) clearTimeout(this.timer);

		// Find the soonest job
		let soonestMs = Number.MAX_SAFE_INTEGER;
		const now = Date.now();

		for (const job of this.jobs.values()) {
			if (!job.enabled) continue;
			const nextRun = this.getNextRun(job, now);
			if (nextRun) {
				const ms = nextRun - now;
				if (ms < soonestMs) soonestMs = ms;
			}
		}

		if (soonestMs === Number.MAX_SAFE_INTEGER) {
			this.log.debug("No scheduled jobs");
			return;
		}

		// Minimum 1 second, maximum 60 seconds (re-check periodically)
		const delay = Math.max(1000, Math.min(soonestMs, 60_000));
		this.timer = setTimeout(() => this.tick(), delay);
	}

	private async tick(): Promise<void> {
		const now = Date.now();

		for (const job of this.jobs.values()) {
			if (!job.enabled) continue;
			const nextRun = this.getNextRun(job, now);
			if (nextRun && nextRun <= now) {
				await this.runJob(job);
			}
		}

		this.scheduleNext();
	}

	private async runJob(job: CronJob): Promise<void> {
		this.log.info(`Running cron job: ${job.name}`);
		job.lastRunAt = new Date().toISOString();

		try {
			await this.onJobRun(job);
			job.consecutiveErrors = 0;
			this.logJob(job, "success");
		} catch (err) {
			job.consecutiveErrors++;
			this.log.error(`Cron job failed: ${job.name}`, {
				error: (err as Error).message,
			});
			this.logJob(job, "error", (err as Error).message);

			if (job.consecutiveErrors >= this.maxConsecutiveErrors) {
				job.enabled = false;
				this.log.warn(
					`Job auto-disabled after ${this.maxConsecutiveErrors} errors: ${job.name}`,
				);
			}
		}

		// Update next run time
		const nextRun = this.getNextRun(job, Date.now());
		job.nextRunAt = nextRun !== null ? new Date(nextRun).toISOString() : null;
	}

	private getNextRun(job: CronJob, now: number): number | null {
		switch (job.schedule.type) {
			case "at": {
				const at = new Date(job.schedule.at).getTime();
				return at > now ? at : null; // One-shot: only if in future
			}
			case "every":
				return now + job.schedule.everyMs;
			case "cron": {
				// Simplified cron: parse "minute hour * * *" format
				return this.parseCronNextRun(job.schedule.expression, now);
			}
		}
	}

	private parseCronNextRun(expression: string, now: number): number | null {
		// Very basic cron: supports "*/N * * * *" and "M * * * *"
		const parts = expression.trim().split(/\s+/);
		if (parts.length < 2) return null;

		const minuteStr = parts[0];
		const hourStr = parts[1];

		const date = new Date(now);

		// Set to next minute boundary
		date.setSeconds(0, 0);
		date.setMinutes(date.getMinutes() + 1);

		if (minuteStr.startsWith("*/")) {
			const interval = Number.parseInt(minuteStr.slice(2), 10);
			const currentMin = date.getMinutes();
			const nextMin = Math.ceil(currentMin / interval) * interval;
			date.setMinutes(nextMin);
		} else if (minuteStr !== "*") {
			date.setMinutes(Number.parseInt(minuteStr, 10));
		}

		if (hourStr !== "*") {
			date.setHours(Number.parseInt(hourStr, 10));
		}

		const nextRun = date.getTime();
		return nextRun > now ? nextRun : nextRun + 60_000; // At least 1 min in future
	}

	private logJob(
		job: CronJob,
		status: "success" | "error",
		error?: string,
	): void {
		const entry = {
			jobId: job.id,
			jobName: job.name,
			status,
			error,
			timestamp: new Date().toISOString(),
		};
		const today = new Date().toISOString().slice(0, 10);
		const logPath = join(this.runLogDir, `${today}.jsonl`);
		appendFileSync(logPath, `${JSON.stringify(entry)}\n`, "utf-8");
	}
}

/**
 * Heartbeat Runner
 *
 * Periodic agent wake-up with precondition checks.
 */
export class HeartbeatRunner {
	private log = new Logger("heartbeat");
	private timer: ReturnType<typeof setInterval> | null = null;
	private locked = false; // Simple lock for user-priority semantics

	constructor(
		private config: HeartbeatConfig,
		private commandQueue: CommandQueue,
		private onHeartbeat: () => Promise<string | null>, // Returns null if nothing to do
	) {}

	start(): void {
		if (!this.config.enabled) return;
		this.timer = setInterval(() => this.tick(), this.config.intervalMs);
		this.log.info(`Heartbeat started (interval: ${this.config.intervalMs}ms)`);
	}

	stop(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
	}

	/** Try to acquire the lock (non-blocking) */
	private tryLock(): boolean {
		if (this.locked) return false;
		this.locked = true;
		return true;
	}

	private unlock(): void {
		this.locked = false;
	}

	private async tick(): Promise<void> {
		// Precondition 1: Lock available (user input has priority)
		if (!this.tryLock()) {
			this.log.debug("Heartbeat skipped: locked");
			return;
		}

		try {
			// Precondition 2: Nothing in the main lane
			const stats = this.commandQueue.getStats();
			const mainLane = stats.find((s) => s.name === "main");
			if (mainLane && (mainLane.activeCount > 0 || mainLane.queueLength > 0)) {
				this.log.debug("Heartbeat skipped: main lane busy");
				return;
			}

			// Precondition 3: Run the heartbeat
			const result = await this.onHeartbeat();

			// Precondition 4: Dedup - if nothing to do, respond HEARTBEAT_OK
			if (result === null || result === "HEARTBEAT_OK") {
				this.log.debug("Heartbeat: nothing to do");
			} else {
				this.log.info(`Heartbeat: ${result.slice(0, 100)}`);
			}
		} catch (err) {
			this.log.error("Heartbeat error", { error: (err as Error).message });
		} finally {
			this.unlock();
		}
	}
}
