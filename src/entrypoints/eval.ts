#!/usr/bin/env tsx
/**
 * Evaluation Entry Point
 *
 * Runs the evaluation pipeline: grader cascade + metrics computation.
 * Usage: npm run eval
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { EvalRunner } from "../evaluation/graders.js";
import { MetricsCalculator } from "../evaluation/metrics.js";
import { createLogger } from "../observability/logger.js";

const log = createLogger("eval");

// ============================================================
// Load .env
// ============================================================

function loadEnv(): void {
  const envPath = resolve(".env");
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

loadEnv();

// ============================================================
// Demo Eval Cases
// ============================================================

const DEMO_CASES = [
  {
    id: "exact-match-1",
    input: "Say 'hello world'",
    expected: "hello world",
  },
  {
    id: "regex-1",
    input: "Write an error message with a 3-digit code",
    assertions: ["error", "\\d{3}"],
  },
  {
    id: "rubric-1",
    input: "Write a short essay about AI",
    rubric: ["keyword:AI", "min_length:20", "section:Introduction"],
  },
  {
    id: "json-schema-1",
    input: "Output a JSON object with name and age fields",
    expectedSchema: { name: { type: "string" }, age: { type: "number" } },
  },
];

const DEMO_OUTPUTS: Record<string, string> = {
  "exact-match-1": "hello world",
  "regex-1": "Error code: 404 — resource not found",
  "rubric-1": "Introduction\n\nAI is transforming the world. The rapid advancement of artificial intelligence has changed how we work and live.\n",
  "json-schema-1": '{"name": "Alice", "age": 30}',
};

// ============================================================
// Main
// ============================================================

async function main(): Promise<void> {
  const workspaceDir = process.env.WORKSPACE_DIR || "./workspace";

  log.info("=== Evaluation Pipeline ===");
  log.info(`Workspace: ${workspaceDir}`);
  log.info(`Cases: ${DEMO_CASES.length}`);

  const runner = new EvalRunner(workspaceDir);
  const metrics = new MetricsCalculator(workspaceDir);

  // Run eval cascade
  const results = [];
  for (const evalCase of DEMO_CASES) {
    const output = DEMO_OUTPUTS[evalCase.id] || "";
    const result = await runner.evaluate(output, evalCase);
    results.push(result);

    const status = result.passed ? "✓ PASS" : "✗ FAIL";
    log.info(
      `  ${status} [${result.caseId}] score=${result.finalScore} grades=${result.grades.length}`,
    );
  }

  // Compute metrics
  const trials = results.map((r) => ({
    taskId: r.caseId,
    passed: r.passed,
    score: r.finalScore,
    attempt: 1,
    timestamp: r.evaluatedAt,
  }));

  const aggregate = metrics.computeAggregate(trials, [1, 3, 5]);

  log.info("");
  log.info("=== Aggregate Metrics ===");
  log.info(`  Tasks: ${aggregate.totalTasks}`);
  log.info(`  Pass Rate: ${Math.round(aggregate.overallPassRate * 100)}%`);
  log.info(`  Mean Score: ${Math.round(aggregate.meanScore * 100)}%`);

  for (const pk of aggregate.passAtK) {
    log.info(
      `  Pass@${pk.k}: ${Math.round(pk.passAtK * 100)}% (Wilson: ${Math.round(pk.confidence * 100)}%)`,
    );
  }

  log.info("");
  log.info("Evaluation complete.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
