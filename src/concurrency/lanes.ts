/**
 * Named Lane Concurrency System
 *
 * Serializes commands per named lane to prevent race conditions.
 * Each lane is a FIFO queue with a concurrency limit (default 1).
 * Generation tracking: stale tasks from old generations are silently dropped.
 *
 * Design (from claw0 s10):
 *   - Named lanes: each session/context gets its own lane
 *   - FIFO ordering within a lane
 *   - Concurrency limit per lane (default 1 = serialized)
 *   - Generation counter: on reset, old tasks are discarded
 *   - Non-blocking: enqueue returns a Promise that resolves when the task completes
 */

import { Logger } from "../observability/logger.js";

export interface LaneTask<T> {
	id: string;
	execute: () => Promise<T>;
	resolve: (value: T) => void;
	reject: (error: Error) => void;
	enqueuedAt: string;
	generation: number;
}

export class LaneQueue {
	private queue: LaneTask<unknown>[] = [];
	private running = 0;
	private currentGeneration = 0;

	constructor(
		public readonly name: string,
		private maxConcurrency,
		private log: Logger,
	) {}

	/** Enqueue a task. Returns a Promise that resolves with the task result. */
	enqueue<T>(execute: () => Promise<T>): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			const task: LaneTask<T> = {
				id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
				execute,
				resolve: resolve as (value: unknown) => void,
				reject,
				enqueuedAt: new Date().toISOString(),
				generation: this.currentGeneration,
			};

			this.queue.push(task as LaneTask<unknown>);
			this.log.debug(
				`Task enqueued in lane "${this.name}": ${task.id} (queue: ${this.queue.length})`,
			);
			this.processNext();
		});
	}

	/** Reset all lanes, incrementing the generation counter */
	reset(): void {
		this.currentGeneration++;
		// Reject all queued (not yet running) tasks
		for (const task of this.queue) {
			task.reject(new Error("Task dropped: lane was reset"));
		}
		this.queue = [];
		this.log.info(
			`Lane "${this.name}" reset (generation: ${this.currentGeneration})`,
		);
	}

	/** Get queue length */
	get length(): number {
		return this.queue.length;
	}

	/** Get number of running tasks */
	get activeCount(): number {
		return this.running;
	}

	/** Get current generation */
	get generation(): number {
		return this.currentGeneration;
	}

	// ============================================================
	// Private
	// ============================================================

	private async processNext(): Promise<void> {
		if (this.running >= this.maxConcurrency) return;
		const task = this.queue.shift();
		if (!task) return;

		// Drop stale tasks from old generations
		if (task.generation < this.currentGeneration) {
			this.log.debug(
				`Dropping stale task ${task.id} (gen ${task.generation} < ${this.currentGeneration})`,
			);
			task.reject(new Error("Task dropped: lane was reset"));
			this.processNext();
			return;
		}

		this.running++;
		this.log.debug(
			`Task started in lane "${this.name}": ${task.id} (active: ${this.running})`,
		);

		try {
			const result = await task.execute();
			task.resolve(result);
		} catch (err) {
			task.reject(err as Error);
		} finally {
			this.running--;
			this.log.debug(
				`Task completed in lane "${this.name}": ${task.id} (active: ${this.running})`,
			);
			this.processNext();
		}
	}
}

/**
 * CommandQueue - manages named lanes.
 *
 * Lanes are created lazily on first use.
 * Call resetAll() to clear all lanes (e.g., on gateway restart).
 */
export class CommandQueue {
	private lanes = new Map<string, LaneQueue>();
	private log = new Logger("lanes");

	/** Get or create a lane */
	getLane(name: string, maxConcurrency = 1): LaneQueue {
		if (!this.lanes.has(name)) {
			this.lanes.set(name, new LaneQueue(name, maxConcurrency, this.log));
		}
		const lane = this.lanes.get(name);
		if (!lane) throw new Error(`Lane "${name}" not found after creation`);
		return lane;
	}

	/** Enqueue a task in a named lane */
	enqueue<T>(laneName: string, execute: () => Promise<T>): Promise<T> {
		return this.getLane(laneName).enqueue(execute);
	}

	/** Reset a specific lane */
	resetLane(name: string): void {
		this.lanes.get(name)?.reset();
	}

	/** Reset all lanes */
	resetAll(): void {
		for (const lane of this.lanes.values()) {
			lane.reset();
		}
		this.log.info("All lanes reset");
	}

	/** Get stats for all lanes */
	getStats(): Array<{
		name: string;
		queueLength: number;
		activeCount: number;
		generation: number;
	}> {
		return Array.from(this.lanes.entries()).map(([name, lane]) => ({
			name,
			queueLength: lane.length,
			activeCount: lane.activeCount,
			generation: lane.generation,
		}));
	}
}
