/**
 * Online Evaluation Sampler
 *
 * Continuously samples agent interactions for evaluation.
 * Not every interaction is graded (too expensive); instead:
 *
 *   - Stratified sampling: ensure coverage across task types
 *   - Adaptive sampling: sample more when performance degrades
 *   - Trigger-based sampling: always sample on errors or novel inputs
 *
 * Design (from knowledge base):
 *   - First failure = first test case
 *   - Sample rate adapts to confidence: low confidence → more samples
 *   - Budget-aware: cap evaluations per day to control costs
 *   - Results feed back into metrics.ts for Pass@k tracking
 */

import { existsSync, mkdirSync, appendFileSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Logger } from "../observability/logger.js";

export type TaskType = "coding" | "analysis" | "writing" | "reasoning" | "tool_use" | "other";

export interface SampledInteraction {
  id: string;
  taskId: string;
  taskType: TaskType;
  input: string;
  output: string;
  sampledAt: string;
  sampleReason: "random" | "stratified" | "adaptive" | "triggered";
}

export interface SamplerConfig {
  baseRate: number;           // Base sampling probability (0-1)
  budgetPerDay: number;       // Max evaluations per day
  adaptiveThreshold: number;  // Score below which sampling increases
  boostMultiplier: number;    // Multiply rate when adaptive triggering
  alwaysSampleOnError: boolean;
  alwaysSampleNovel: boolean;
}

export const DEFAULT_SAMPLER_CONFIG: SamplerConfig = {
  baseRate: 0.1,
  budgetPerDay: 50,
  adaptiveThreshold: 0.5,
  boostMultiplier: 3,
  alwaysSampleOnError: true,
  alwaysSampleNovel: true,
};

export class OnlineSampler {
  private log = new Logger("sampler");
  private config: SamplerConfig;
  private sampleDir: string;
  private dailyCounts = new Map<string, number>();
  private taskTypeCounts = new Map<TaskType, number>();
  private recentScores: number[] = [];

  constructor(
    workspaceDir: string,
    config: Partial<SamplerConfig> = {},
  ) {
    this.config = { ...DEFAULT_SAMPLER_CONFIG, ...config };
    this.sampleDir = join(workspaceDir, ".eval", "samples");
    mkdirSync(this.sampleDir, { recursive: true });
  }

  /**
   * Decide whether to sample this interaction.
   * Returns true if the interaction should be evaluated.
   */
  shouldSample(context: {
    taskType: TaskType;
    hasError?: boolean;
    isNovel?: boolean;
    recentScore?: number;
  }): boolean {
    const today = new Date().toISOString().slice(0, 10);
    const todayCount = this.dailyCounts.get(today) || 0;

    // Budget check
    if (todayCount >= this.config.budgetPerDay) {
      return false;
    }

    // Always sample on error
    if (this.config.alwaysSampleOnError && context.hasError) {
      return true;
    }

    // Always sample novel inputs
    if (this.config.alwaysSampleNovel && context.isNovel) {
      return true;
    }

    // Adaptive: boost rate when recent performance is low
    let rate = this.config.baseRate;
    if (context.recentScore !== undefined && context.recentScore < this.config.adaptiveThreshold) {
      rate = Math.min(1, rate * this.config.boostMultiplier);
    }

    // Stratified: boost underrepresented task types
    const typeCount = this.taskTypeCounts.get(context.taskType) || 0;
    const totalSampled = [...this.taskTypeCounts.values()].reduce((a, b) => a + b, 0);
    if (totalSampled > 0) {
      const typeRate = typeCount / totalSampled;
      const expectedRate = 1 / 6; // 6 task types
      if (typeRate < expectedRate) {
        rate = Math.min(1, rate * 1.5);
      }
    }

    return Math.random() < rate;
  }

  /**
   * Record a sampled interaction for later evaluation.
   */
  recordSample(
    interaction: Omit<SampledInteraction, "id" | "sampledAt" | "sampleReason">,
    reason: SampledInteraction["sampleReason"] = "random",
  ): SampledInteraction {
    const today = new Date().toISOString().slice(0, 10);
    this.dailyCounts.set(today, (this.dailyCounts.get(today) || 0) + 1);
    this.taskTypeCounts.set(
      interaction.taskType,
      (this.taskTypeCounts.get(interaction.taskType) || 0) + 1,
    );

    const sample: SampledInteraction = {
      ...interaction,
      id: `sample-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      sampledAt: new Date().toISOString(),
      sampleReason: reason,
    };

    const filePath = join(this.sampleDir, `${today}.jsonl`);
    appendFileSync(filePath, `${JSON.stringify(sample)}\n`, "utf-8");

    this.log.debug(`Sample recorded: ${interaction.taskId} (${interaction.taskType}, reason: ${reason})`);
    return sample;
  }

  /**
   * Record a score for adaptive sampling.
   */
  recordScore(score: number): void {
    this.recentScores.push(score);
    // Keep last 20 scores
    if (this.recentScores.length > 20) {
      this.recentScores.shift();
    }
  }

  /** Get the recent average score */
  getRecentAverage(): number {
    if (this.recentScores.length === 0) return 1;
    return this.recentScores.reduce((a, b) => a + b, 0) / this.recentScores.length;
  }

  /** Get today's sample count */
  getTodayCount(): number {
    const today = new Date().toISOString().slice(0, 10);
    return this.dailyCounts.get(today) || 0;
  }

  /** Get remaining budget for today */
  getRemainingBudget(): number {
    return Math.max(0, this.config.budgetPerDay - this.getTodayCount());
  }

  /** Get sampling statistics */
  getStats(): {
    totalSamples: number;
    todaySamples: number;
    remainingBudget: number;
    taskTypeDistribution: Record<TaskType, number>;
    recentAverageScore: number;
  } {
    const taskTypeDistribution: Record<TaskType, number> = {
      coding: 0, analysis: 0, writing: 0, reasoning: 0, tool_use: 0, other: 0,
    };
    for (const [type, count] of this.taskTypeCounts) {
      taskTypeDistribution[type] = count;
    }

    let totalSamples = 0;
    for (const count of this.dailyCounts.values()) {
      totalSamples += count;
    }

    return {
      totalSamples,
      todaySamples: this.getTodayCount(),
      remainingBudget: this.getRemainingBudget(),
      taskTypeDistribution,
      recentAverageScore: this.getRecentAverage(),
    };
  }

  /** List all sampled interactions */
  listSamples(): SampledInteraction[] {
    if (!existsSync(this.sampleDir)) return [];
    const samples: SampledInteraction[] = [];
    for (const file of readdirSync(this.sampleDir)) {
      if (!file.endsWith(".jsonl")) continue;
      try {
        const content = readFileSync(join(this.sampleDir, file), "utf-8");
        for (const line of content.split("\n")) {
          if (line.trim()) samples.push(JSON.parse(line));
        }
      } catch {
        // skip
      }
    }
    return samples.sort((a, b) => b.sampledAt.localeCompare(a.sampledAt));
  }
}
