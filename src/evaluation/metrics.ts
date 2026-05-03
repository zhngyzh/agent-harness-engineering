/**
 * Evaluation Metrics
 *
 * Implements standard agent evaluation metrics:
 *
 *   Pass@k — probability that at least 1 of k attempts passes
 *     For n trials with c successes: Pass@k = 1 - C(n-c, k) / C(n, k)
 *     Estimated via binomial: 1 - (1 - p)^k where p = c/n
 *
 *   Pass^k — probability that ALL k attempts pass
 *     For n trials with c successes: Pass^k = C(c, k) / C(n, k)
 *     Estimated via binomial: p^k where p = c/n
 *
 *   Mean Reciprocal Rank (MRR) — average of 1/rank of first correct answer
 *
 *   Pass Rate — simple fraction of passing attempts
 *
 * Design (from knowledge base):
 *   - First failure = first test case
 *   - Metrics computed per-task and aggregated
 *   - Confidence intervals via Wilson score
 *   - Results saved to .eval/metrics.jsonl for tracking over time
 */

import { existsSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { Logger } from "../observability/logger.js";

export interface TrialResult {
  taskId: string;
  passed: boolean;
  score: number;     // 0-1
  attempt: number;   // which attempt (1-indexed)
  timestamp: string;
}

export interface PassAtKResult {
  k: number;
  passAtK: number;       // Estimated Pass@k
  passK: number;         // Estimated Pass^k
  sampleSize: number;
  successes: number;
  confidence: number;    // Wilson score lower bound
}

export interface TaskMetrics {
  taskId: string;
  passRate: number;
  meanScore: number;
  attempts: number;
  bestScore: number;
  mrr: number;           // Mean Reciprocal Rank
}

export interface AggregateMetrics {
  totalTasks: number;
  totalAttempts: number;
  overallPassRate: number;
  meanScore: number;
  passAtK: PassAtKResult[];
  taskMetrics: TaskMetrics[];
  computedAt: string;
}

export class MetricsCalculator {
  private log = new Logger("metrics");
  private metricsDir: string;

  constructor(workspaceDir: string) {
    this.metricsDir = join(workspaceDir, ".eval");
    mkdirSync(this.metricsDir, { recursive: true });
  }

  /**
   * Compute Pass@k and Pass^k from trial results.
   *
   * @param trials — all trial results across tasks
   * @param kValues — which k values to compute (default: [1, 3, 5, 10])
   */
  computePassAtK(
    trials: TrialResult[],
    kValues: number[] = [1, 3, 5, 10],
  ): PassAtKResult[] {
    // Group trials by task
    const taskTrials = new Map<string, TrialResult[]>();
    for (const trial of trials) {
      const existing = taskTrials.get(trial.taskId) || [];
      existing.push(trial);
      taskTrials.set(trial.taskId, existing);
    }

    const n = taskTrials.size;
    const successes = [...taskTrials.values()].filter(
      (trials) => trials.some((t) => t.passed),
    ).length;

    const p = n > 0 ? successes / n : 0;
    const confidence = this.wilsonLowerBound(successes, n);

    const results: PassAtKResult[] = [];

    for (const k of kValues) {
      // Pass@k = 1 - (1-p)^k
      const passAtK = 1 - Math.pow(1 - p, k);
      // Pass^k = p^k
      const passK = Math.pow(p, k);

      results.push({
        k,
        passAtK: Math.round(passAtK * 1000) / 1000,
        passK: Math.round(passK * 1000) / 1000,
        sampleSize: n,
        successes,
        confidence: Math.round(confidence * 1000) / 1000,
      });
    }

    return results;
  }

  /**
   * Compute per-task metrics.
   */
  computeTaskMetrics(trials: TrialResult[]): TaskMetrics[] {
    const taskTrials = new Map<string, TrialResult[]>();
    for (const trial of trials) {
      const existing = taskTrials.get(trial.taskId) || [];
      existing.push(trial);
      taskTrials.set(trial.taskId, existing);
    }

    const metrics: TaskMetrics[] = [];

    for (const [taskId, taskT] of taskTrials) {
      const sorted = [...taskT].sort((a, b) => a.attempt - b.attempt);
      const passedCount = sorted.filter((t) => t.passed).length;
      const scores = sorted.map((t) => t.score);

      // MRR: 1/rank of first passing attempt
      const firstPassIdx = sorted.findIndex((t) => t.passed);
      const mrr = firstPassIdx >= 0 ? 1 / (firstPassIdx + 1) : 0;

      metrics.push({
        taskId,
        passRate: sorted.length > 0 ? passedCount / sorted.length : 0,
        meanScore: scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0,
        attempts: sorted.length,
        bestScore: scores.length > 0 ? Math.max(...scores) : 0,
        mrr: Math.round(mrr * 1000) / 1000,
      });
    }

    return metrics.sort((a, b) => a.taskId.localeCompare(b.taskId));
  }

  /**
   * Compute aggregate metrics across all trials.
   */
  computeAggregate(trials: TrialResult[], kValues?: number[]): AggregateMetrics {
    const taskMetrics = this.computeTaskMetrics(trials);
    const passAtK = this.computePassAtK(trials, kValues);

    const totalAttempts = trials.length;
    const passedAttempts = trials.filter((t) => t.passed).length;
    const scores = trials.map((t) => t.score);

    const aggregate: AggregateMetrics = {
      totalTasks: taskMetrics.length,
      totalAttempts,
      overallPassRate: totalAttempts > 0 ? passedAttempts / totalAttempts : 0,
      meanScore: scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0,
      passAtK,
      taskMetrics,
      computedAt: new Date().toISOString(),
    };

    this.save(aggregate);
    return aggregate;
  }

  /**
   * Wilson score interval lower bound for confidence estimation.
   * More accurate than normal approximation for small samples.
   */
  wilsonLowerBound(successes: number, total: number, z: number = 1.96): number {
    if (total === 0) return 0;

    const p = successes / total;
    const z2 = z * z;
    const n = total;

    const denominator = 1 + z2 / n;
    const centre = p + z2 / (2 * n);
    const spread = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);

    return Math.max(0, (centre - spread) / denominator);
  }

  // ============================================================
  // Private
  // ============================================================

  private save(metrics: AggregateMetrics): void {
    const filePath = join(this.metricsDir, "metrics.jsonl");
    appendFileSync(filePath, `${JSON.stringify(metrics)}\n`, "utf-8");
    this.log.info(
      `Metrics: ${metrics.totalTasks} tasks, ${metrics.totalAttempts} attempts, ` +
      `pass rate ${Math.round(metrics.overallPassRate * 100)}%, ` +
      `mean score ${Math.round(metrics.meanScore * 100)}%`,
    );
  }
}
