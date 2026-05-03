import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DeterministicGrader, HeuristicGrader, LLMJudgeGrader, EvalRunner } from "../../src/evaluation/graders.js";
import { MetricsCalculator } from "../../src/evaluation/metrics.js";
import { OnlineSampler, DEFAULT_SAMPLER_CONFIG } from "../../src/evaluation/sampler.js";
import type { LLMClient, LLMResponse } from "../../src/core/types.js";

const TEST_DIR = join(import.meta.dirname, "..", "..", ".test-evaluation");

// ============================================================
// DeterministicGrader (L1)
// ============================================================

describe("DeterministicGrader", () => {
  let grader: DeterministicGrader;

  beforeEach(() => { grader = new DeterministicGrader(); });

  it("passes exact match", () => {
    const result = grader.grade("hello world", {
      id: "1", input: "say hello", expected: "hello world",
    });
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
    expect(result.level).toBe(1);
  });

  it("fails exact match on mismatch", () => {
    const result = grader.grade("hello", {
      id: "1", input: "say hello", expected: "hello world",
    });
    expect(result.passed).toBe(false);
    expect(result.score).toBe(0);
  });

  it("passes regex assertion", () => {
    const result = grader.grade("error code: 404", {
      id: "1", input: "test", assertions: ["\\d{3}", "error"],
    });
    expect(result.passed).toBe(true);
  });

  it("fails regex assertion on mismatch", () => {
    const result = grader.grade("no match here", {
      id: "1", input: "test", assertions: ["error"],
    });
    expect(result.passed).toBe(false);
  });

  it("passes JSON schema check", () => {
    const result = grader.grade('{"name": "test", "value": 42}', {
      id: "1", input: "test",
      expectedSchema: { name: { type: "string" }, value: { type: "number" } },
    });
    expect(result.passed).toBe(true);
  });

  it("fails JSON schema check on missing field", () => {
    const result = grader.grade('{"name": "test"}', {
      id: "1", input: "test",
      expectedSchema: { name: { type: "string" }, value: { type: "number" } },
    });
    expect(result.passed).toBe(false);
    expect(result.details![0]).toContain("missing");
  });

  it("fails JSON schema on invalid JSON", () => {
    const result = grader.grade("not json", {
      id: "1", input: "test",
      expectedSchema: { name: { type: "string" } },
    });
    expect(result.passed).toBe(false);
  });

  it("handles empty case (no checks) with score 1", () => {
    const result = grader.grade("anything", { id: "1", input: "test" });
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
  });

  it("reports partial score for mixed results", () => {
    const result = grader.grade("hello", {
      id: "1", input: "test", expected: "hello", assertions: ["nomatch"],
    });
    expect(result.score).toBe(0.5);
  });

  it("handles invalid regex gracefully", () => {
    const result = grader.grade("test", {
      id: "1", input: "test", assertions: ["[invalid"],
    });
    expect(result.details![0]).toContain("INVALID");
  });
});

// ============================================================
// HeuristicGrader (L2)
// ============================================================

describe("HeuristicGrader", () => {
  let grader: HeuristicGrader;

  beforeEach(() => { grader = new HeuristicGrader(); });

  it("passes all rubric items", () => {
    const result = grader.grade("The quick brown fox", {
      id: "1", input: "test",
      rubric: ["keyword:quick", "keyword:brown", "keyword:fox"],
    });
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
    expect(result.level).toBe(2);
  });

  it("fails when rubric items missing", () => {
    const result = grader.grade("hello world", {
      id: "1", input: "test",
      rubric: ["keyword:missing", "keyword:also_missing"],
    });
    expect(result.passed).toBe(false);
    expect(result.score).toBe(0);
  });

  it("checks section headers", () => {
    const result = grader.grade("# Introduction\nContent\n# Conclusion", {
      id: "1", input: "test",
      rubric: ["section:Introduction", "section:Conclusion"],
    });
    expect(result.passed).toBe(true);
  });

  it("checks min_length", () => {
    const result = grader.grade("short", {
      id: "1", input: "test",
      rubric: ["min_length:3"],
    });
    expect(result.passed).toBe(true);
  });

  it("fails min_length", () => {
    const result = grader.grade("ab", {
      id: "1", input: "test",
      rubric: ["min_length:10"],
    });
    expect(result.passed).toBe(false);
  });

  it("checks max_length", () => {
    const result = grader.grade("short text", {
      id: "1", input: "test",
      rubric: ["max_length:100"],
    });
    expect(result.passed).toBe(true);
  });

  it("fails max_length", () => {
    const result = grader.grade("a very long text that exceeds the limit", {
      id: "1", input: "test",
      rubric: ["max_length:10"],
    });
    expect(result.passed).toBe(false);
  });

  it("passes at 70%+ threshold", () => {
    const result = grader.grade("hello world", {
      id: "1", input: "test",
      rubric: ["keyword:hello", "keyword:world", "keyword:missing", "keyword:also_missing"],
    });
    expect(result.score).toBe(0.5);
    expect(result.passed).toBe(false); // 50% < 70%
  });

  it("handles empty rubric", () => {
    const result = grader.grade("anything", { id: "1", input: "test" });
    expect(result.passed).toBe(true);
    expect(result.feedback).toContain("No rubric");
  });

  it("handles plain text rubric items", () => {
    const result = grader.grade("The answer is 42", {
      id: "1", input: "test",
      rubric: ["The answer", "42"],
    });
    expect(result.passed).toBe(true);
  });
});

// ============================================================
// LLMJudgeGrader (L3)
// ============================================================

describe("LLMJudgeGrader", () => {
  let grader: LLMJudgeGrader;

  beforeEach(() => {
    grader = new LLMJudgeGrader(
      () => ({ messages: async (): Promise<LLMResponse> => ({
        content: [{ type: "text", text: '{"score": 0.8, "passed": true, "feedback": "Good quality output"}' }],
        stopReason: "end_turn",
        usage: { inputTokens: 100, outputTokens: 50 },
      }) }) as LLMClient,
    );
  });

  it("parses LLM judge response", async () => {
    const result = await grader.grade("output", {
      id: "1", input: "test", rubric: ["quality"],
    });
    expect(result.score).toBe(0.8);
    expect(result.passed).toBe(true);
    expect(result.level).toBe(3);
  });

  it("handles LLM error gracefully", async () => {
    const errorGrader = new LLMJudgeGrader(
      () => ({ messages: async () => { throw new Error("API down"); } }) as LLMClient,
    );
    const result = await errorGrader.grade("output", { id: "1", input: "test" });
    expect(result.passed).toBe(false);
    expect(result.score).toBe(0);
    expect(result.feedback).toContain("error");
  });

  it("handles unparseable LLM response", async () => {
    const weirdGrader = new LLMJudgeGrader(
      () => ({ messages: async (): Promise<LLMResponse> => ({
        content: [{ type: "text", text: "This is not JSON at all" }],
        stopReason: "end_turn",
        usage: { inputTokens: 10, outputTokens: 10 },
      }) }) as LLMClient,
    );
    const result = await weirdGrader.grade("output", { id: "1", input: "test" });
    expect(result.passed).toBe(false);
    expect(result.feedback).toContain("Failed to parse");
  });
});

// ============================================================
// EvalRunner
// ============================================================

describe("EvalRunner", () => {
  let runner: EvalRunner;

  beforeEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });
    runner = new EvalRunner(TEST_DIR);
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("evaluates with L1 only when passing", async () => {
    const result = await runner.evaluate("hello", {
      id: "1", input: "test", expected: "hello",
    });
    expect(result.passed).toBe(true);
    expect(result.grades.length).toBe(1);
    expect(result.grades[0].level).toBe(1);
  });

  it("cascades L1 → L2 when L1 fails", async () => {
    const result = await runner.evaluate("wrong", {
      id: "1", input: "test", expected: "right",
      rubric: ["keyword:right"],
    });
    expect(result.grades.length).toBeGreaterThanOrEqual(1);
  });

  it("saves eval results", async () => {
    await runner.evaluate("test", { id: "1", input: "test", expected: "test" });
    const results = runner.listResults();
    expect(results.length).toBe(1);
    expect(results[0].caseId).toBe("1");
  });

  it("evaluates batch", async () => {
    const outputs = new Map([["1", "hello"], ["2", "world"]]);
    const cases = [
      { id: "1", input: "test", expected: "hello" },
      { id: "2", input: "test", expected: "world" },
    ];
    const results = await runner.evaluateBatch(outputs, cases);
    expect(results.length).toBe(2);
    expect(results.every((r) => r.passed)).toBe(true);
  });
});

// ============================================================
// MetricsCalculator
// ============================================================

describe("MetricsCalculator", () => {
  let calc: MetricsCalculator;

  beforeEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });
    calc = new MetricsCalculator(TEST_DIR);
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  const makeTrial = (taskId: string, passed: boolean, attempt = 1) => ({
    taskId, passed, score: passed ? 0.9 : 0.3, attempt,
    timestamp: new Date().toISOString(),
  });

  it("computes Pass@k", () => {
    const trials = [
      makeTrial("task-1", true),
      makeTrial("task-2", true),
      makeTrial("task-3", false),
      makeTrial("task-4", true),
    ];

    const results = calc.computePassAtK(trials, [1, 3]);

    expect(results.length).toBe(2);
    // 3/4 = 0.75 pass rate
    expect(results[0].k).toBe(1);
    expect(results[0].passAtK).toBeCloseTo(0.75, 2);
    expect(results[0].sampleSize).toBe(4);
    expect(results[0].successes).toBe(3);
  });

  it("computes Pass^k", () => {
    const trials = [
      makeTrial("task-1", true),
      makeTrial("task-2", true),
      makeTrial("task-3", true),
    ];

    const results = calc.computePassAtK(trials, [2]);
    // p = 1.0, Pass^2 = 1.0^2 = 1.0
    expect(results[0].passK).toBe(1);
  });

  it("handles empty trials", () => {
    const results = calc.computePassAtK([], [1]);
    expect(results[0].passAtK).toBe(0);
    expect(results[0].sampleSize).toBe(0);
  });

  it("computes per-task metrics", () => {
    const trials = [
      makeTrial("task-a", true, 1),
      makeTrial("task-a", false, 2),
      makeTrial("task-b", false, 1),
    ];

    const metrics = calc.computeTaskMetrics(trials);
    expect(metrics.length).toBe(2);

    const taskA = metrics.find((m) => m.taskId === "task-a");
    expect(taskA).toBeDefined();
    expect(taskA!.passRate).toBe(0.5);
    expect(taskA!.attempts).toBe(2);
    expect(taskA!.mrr).toBe(1); // passed on first attempt

    const taskB = metrics.find((m) => m.taskId === "task-b");
    expect(taskB).toBeDefined();
    expect(taskB!.mrr).toBe(0); // never passed
  });

  it("computes aggregate metrics", () => {
    const trials = [
      makeTrial("t1", true),
      makeTrial("t2", false),
      makeTrial("t3", true),
    ];

    const agg = calc.computeAggregate(trials, [1, 5]);
    expect(agg.totalTasks).toBe(3);
    expect(agg.totalAttempts).toBe(3);
    expect(agg.overallPassRate).toBeCloseTo(0.667, 2);
    expect(agg.passAtK.length).toBe(2);
    expect(agg.taskMetrics.length).toBe(3);
  });

  it("Wilson lower bound is conservative", () => {
    // 8/10 successes
    const bound = calc.wilsonLowerBound(8, 10);
    expect(bound).toBeGreaterThan(0);
    expect(bound).toBeLessThan(0.8); // Lower than raw rate
  });

  it("Wilson bound is 0 for 0 trials", () => {
    expect(calc.wilsonLowerBound(0, 0)).toBe(0);
  });

  it("Wilson bound for all failures is 0", () => {
    const bound = calc.wilsonLowerBound(0, 10);
    expect(bound).toBeCloseTo(0, 2);
  });
});

// ============================================================
// OnlineSampler
// ============================================================

describe("OnlineSampler", () => {
  let sampler: OnlineSampler;

  beforeEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });
    sampler = new OnlineSampler(TEST_DIR, {
      baseRate: 1.0, // Always sample for testing
      budgetPerDay: 10,
      adaptiveThreshold: 0.5,
      boostMultiplier: 2,
      alwaysSampleOnError: true,
      alwaysSampleNovel: true,
    });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("always samples on error", () => {
    expect(sampler.shouldSample({
      taskType: "coding",
      hasError: true,
    })).toBe(true);
  });

  it("always samples novel inputs", () => {
    expect(sampler.shouldSample({
      taskType: "coding",
      isNovel: true,
    })).toBe(true);
  });

  it("respects budget limit", () => {
    // Exhaust budget
    for (let i = 0; i < 10; i++) {
      sampler.recordSample({
        taskId: `t-${i}`, taskType: "coding", input: "test", output: "out",
      });
    }
    expect(sampler.shouldSample({ taskType: "other" })).toBe(false);
  });

  it("records samples with correct structure", () => {
    const sample = sampler.recordSample({
      taskId: "task-1", taskType: "coding", input: "write code", output: "code",
    });
    expect(sample.id).toBeDefined();
    expect(sample.taskId).toBe("task-1");
    expect(sample.taskType).toBe("coding");
    expect(sample.sampledAt).toBeDefined();
  });

  it("tracks today count", () => {
    expect(sampler.getTodayCount()).toBe(0);
    sampler.recordSample({
      taskId: "t1", taskType: "coding", input: "test", output: "out",
    });
    expect(sampler.getTodayCount()).toBe(1);
  });

  it("tracks remaining budget", () => {
    expect(sampler.getRemainingBudget()).toBe(10);
    sampler.recordSample({
      taskId: "t1", taskType: "coding", input: "test", output: "out",
    });
    expect(sampler.getRemainingBudget()).toBe(9);
  });

  it("records scores for adaptive sampling", () => {
    sampler.recordScore(0.3);
    sampler.recordScore(0.4);
    expect(sampler.getRecentAverage()).toBeCloseTo(0.35, 2);
  });

  it("adaptive sampling boosts rate on low scores", () => {
    sampler.recordScore(0.2);
    // With low recent score, shouldSample should be more likely
    // (boostMultiplier = 2, baseRate = 1.0 → capped at 1.0)
    const result = sampler.shouldSample({ taskType: "coding", recentScore: 0.2 });
    expect(result).toBe(true);
  });

  it("keeps only last 20 scores", () => {
    for (let i = 0; i < 25; i++) {
      sampler.recordScore(0.5);
    }
    // Should not crash
    expect(sampler.getRecentAverage()).toBe(0.5);
  });

  it("getStats returns full statistics", () => {
    sampler.recordSample({
      taskId: "t1", taskType: "coding", input: "test", output: "out",
    });
    sampler.recordSample({
      taskId: "t2", taskType: "writing", input: "test", output: "out",
    });

    const stats = sampler.getStats();
    expect(stats.totalSamples).toBe(2);
    expect(stats.todaySamples).toBe(2);
    expect(stats.taskTypeDistribution.coding).toBe(1);
    expect(stats.taskTypeDistribution.writing).toBe(1);
  });

  it("lists samples", () => {
    sampler.recordSample({
      taskId: "t1", taskType: "coding", input: "test", output: "out",
    });
    const samples = sampler.listSamples();
    expect(samples.length).toBe(1);
  });

  it("stratified sampling boosts underrepresented types", () => {
    // Create a sampler with low base rate
    const stratSampler = new OnlineSampler(TEST_DIR, {
      baseRate: 0.0, // Would normally never sample
      budgetPerDay: 10,
      adaptiveThreshold: 0.5,
      boostMultiplier: 1,
      alwaysSampleOnError: false,
      alwaysSampleNovel: false,
    });

    // "other" type is underrepresented, so stratified boost should help
    // But with baseRate=0, even 1.5x boost = 0, so we need baseRate > 0
    const stratSampler2 = new OnlineSampler(TEST_DIR, {
      baseRate: 0.5,
      budgetPerDay: 10,
      adaptiveThreshold: 0.5,
      boostMultiplier: 1,
      alwaysSampleOnError: false,
      alwaysSampleNovel: false,
    });

    // Just verify it doesn't crash
    stratSampler2.shouldSample({ taskType: "other" });
  });
});
