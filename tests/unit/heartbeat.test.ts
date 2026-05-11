import { mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CronScheduler } from "../../src/concurrency/heartbeat.js";
import { HeartbeatRunner } from "../../src/concurrency/heartbeat.js";
import { CommandQueue } from "../../src/concurrency/lanes.js";

const TEST_DIR = join(import.meta.dirname, "..", "..", ".test-heartbeat");

// ============================================================
// CronScheduler
// ============================================================

describe("CronScheduler", () => {
	let scheduler: CronScheduler;
	let queue: CommandQueue;
	let runLog: string[];

	beforeEach(() => {
		rmSync(TEST_DIR, { recursive: true, force: true });
		mkdirSync(TEST_DIR, { recursive: true });
		runLog = [];
		queue = new CommandQueue();
		scheduler = new CronScheduler(TEST_DIR, queue, async () => {
			runLog.push("ran");
		});
	});

	afterEach(() => {
		scheduler.stop();
		rmSync(TEST_DIR, { recursive: true, force: true });
	});

	it("adds and lists jobs", () => {
		scheduler.addJob({
			id: "job-1",
			name: "test-job",
			schedule: { type: "every", everyMs: 60_000 },
			action: "do something",
			enabled: true,
			consecutiveErrors: 0,
			lastRunAt: null,
			nextRunAt: null,
			createdAt: new Date().toISOString(),
		});

		const jobs = scheduler.listJobs();
		expect(jobs.length).toBe(1);
		expect(jobs[0].name).toBe("test-job");
	});

	it("removes jobs", () => {
		scheduler.addJob({
			id: "job-1",
			name: "test-job",
			schedule: { type: "every", everyMs: 60_000 },
			action: "do something",
			enabled: true,
			consecutiveErrors: 0,
			lastRunAt: null,
			nextRunAt: null,
			createdAt: new Date().toISOString(),
		});

		expect(scheduler.removeJob("job-1")).toBe(true);
		expect(scheduler.listJobs().length).toBe(0);
		expect(scheduler.removeJob("job-1")).toBe(false);
	});

	it("triggers a job manually", async () => {
		scheduler.addJob({
			id: "manual",
			name: "manual-job",
			schedule: { type: "at", at: new Date(Date.now() + 60_000).toISOString() },
			action: "test action",
			enabled: true,
			consecutiveErrors: 0,
			lastRunAt: null,
			nextRunAt: null,
			createdAt: new Date().toISOString(),
		});

		await scheduler.triggerJob("manual");
		expect(runLog).toEqual(["ran"]);
	});

	it("tracks last run time after trigger", async () => {
		scheduler.addJob({
			id: "track",
			name: "track-job",
			schedule: { type: "at", at: new Date(Date.now() + 60_000).toISOString() },
			action: "test",
			enabled: true,
			consecutiveErrors: 0,
			lastRunAt: null,
			nextRunAt: null,
			createdAt: new Date().toISOString(),
		});

		await scheduler.triggerJob("track");
		const jobs = scheduler.listJobs();
		expect(jobs[0].lastRunAt).not.toBeNull();
	});

	it("auto-disables after 5 consecutive errors", async () => {
		let callCount = 0;
		const errorScheduler = new CronScheduler(TEST_DIR, queue, async () => {
			callCount++;
			throw new Error("persistent failure");
		});

		errorScheduler.addJob({
			id: "fail-job",
			name: "failing",
			schedule: { type: "at", at: new Date(Date.now() + 60_000).toISOString() },
			action: "fail",
			enabled: true,
			consecutiveErrors: 0,
			lastRunAt: null,
			nextRunAt: null,
			createdAt: new Date().toISOString(),
		});

		// Trigger 5 times to hit the error limit
		for (let i = 0; i < 5; i++) {
			try {
				await errorScheduler.triggerJob("fail-job");
			} catch {
				// Expected
			}
		}

		const jobs = errorScheduler.listJobs();
		expect(jobs[0].enabled).toBe(false);
		expect(jobs[0].consecutiveErrors).toBe(5);

		errorScheduler.stop();
	});

	it("resets consecutive errors on success", async () => {
		let callCount = 0;
		const mixedScheduler = new CronScheduler(TEST_DIR, queue, async () => {
			callCount++;
			if (callCount < 3) throw new Error("fail");
			return;
		});

		mixedScheduler.addJob({
			id: "mixed",
			name: "mixed-job",
			schedule: { type: "at", at: new Date(Date.now() + 60_000).toISOString() },
			action: "test",
			enabled: true,
			consecutiveErrors: 0,
			lastRunAt: null,
			nextRunAt: null,
			createdAt: new Date().toISOString(),
		});

		// 2 failures
		for (let i = 0; i < 2; i++) {
			try {
				await mixedScheduler.triggerJob("mixed");
			} catch {
				// Expected
			}
		}

		let jobs = mixedScheduler.listJobs();
		expect(jobs[0].consecutiveErrors).toBe(2);

		// 1 success
		await mixedScheduler.triggerJob("mixed");
		jobs = mixedScheduler.listJobs();
		expect(jobs[0].consecutiveErrors).toBe(0);

		mixedScheduler.stop();
	});

	it("throws on triggerJob for non-existent job", async () => {
		await expect(scheduler.triggerJob("nonexistent")).rejects.toThrow(
			"Job not found",
		);
	});

	it("logs runs to JSONL", async () => {
		scheduler.addJob({
			id: "log-job",
			name: "log-test",
			schedule: { type: "at", at: new Date(Date.now() + 60_000).toISOString() },
			action: "test",
			enabled: true,
			consecutiveErrors: 0,
			lastRunAt: null,
			nextRunAt: null,
			createdAt: new Date().toISOString(),
		});

		await scheduler.triggerJob("log-job");

		const cronDir = join(TEST_DIR, "cron");
		const files = readdirSync(cronDir).filter((f: string) =>
			f.endsWith(".jsonl"),
		);
		expect(files.length).toBe(1);

		const content = readFileSync(join(cronDir, files[0]), "utf-8");
		const entry = JSON.parse(content.trim());
		expect(entry.jobName).toBe("log-test");
		expect(entry.status).toBe("success");
	});
});

// ============================================================
// HeartbeatRunner
// ============================================================

describe("HeartbeatRunner", () => {
	it("does not run when disabled", () => {
		const queue = new CommandQueue();
		let heartbeatCalled = false;

		const runner = new HeartbeatRunner(
			{ intervalMs: 100, enabled: false },
			queue,
			async () => {
				heartbeatCalled = true;
				return null;
			},
		);

		runner.start();
		// No timer should be set
		runner.stop();
		expect(heartbeatCalled).toBe(false);
	});

	it("runs heartbeat on interval when enabled", async () => {
		vi.useFakeTimers();
		const queue = new CommandQueue();
		let callCount = 0;

		const runner = new HeartbeatRunner(
			{ intervalMs: 1000, enabled: true },
			queue,
			async () => {
				callCount++;
				return null;
			},
		);

		runner.start();

		// Advance past one interval
		await vi.advanceTimersByTimeAsync(1100);
		expect(callCount).toBe(1);

		// Advance past another
		await vi.advanceTimersByTimeAsync(1100);
		expect(callCount).toBe(2);

		runner.stop();
		vi.useRealTimers();
	});

	it("skips heartbeat when main lane is busy", async () => {
		vi.useFakeTimers();
		const queue = new CommandQueue();
		let callCount = 0;

		// Occupy the main lane
		const mainLane = queue.getLane("main");
		const longTask = mainLane.enqueue(
			() => new Promise<number>((r) => setTimeout(() => r(1), 10_000)),
		);

		const runner = new HeartbeatRunner(
			{ intervalMs: 500, enabled: true },
			queue,
			async () => {
				callCount++;
				return null;
			},
		);

		runner.start();

		// Advance past interval — heartbeat should skip because main lane is busy
		await vi.advanceTimersByTimeAsync(600);
		expect(callCount).toBe(0);

		runner.stop();
		vi.useRealTimers();
		// Clean up
		queue.resetLane("main");
	});

	it("logs heartbeat result when not HEARTBEAT_OK", async () => {
		vi.useFakeTimers();
		const queue = new CommandQueue();

		const runner = new HeartbeatRunner(
			{ intervalMs: 1000, enabled: true },
			queue,
			async () => "Something needs attention",
		);

		runner.start();

		await vi.advanceTimersByTimeAsync(1100);
		// The heartbeat ran and logged — no crash

		runner.stop();
		vi.useRealTimers();
	});

	it("stop clears the interval", async () => {
		vi.useFakeTimers();
		const queue = new CommandQueue();
		let callCount = 0;

		const runner = new HeartbeatRunner(
			{ intervalMs: 1000, enabled: true },
			queue,
			async () => {
				callCount++;
				return null;
			},
		);

		runner.start();
		await vi.advanceTimersByTimeAsync(1100);
		expect(callCount).toBe(1);

		runner.stop();

		// After stop, no more heartbeats
		await vi.advanceTimersByTimeAsync(2000);
		expect(callCount).toBe(1);

		vi.useRealTimers();
	});
});
