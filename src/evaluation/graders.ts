/**
 * Three-Level Grader System
 *
 * Evaluates agent outputs at three granularity levels:
 *
 *   Level 1 — Deterministic (exact match, regex, assertions)
 *     Fastest, zero cost. Checks: exact output match, regex patterns,
 *     JSON schema validity, code compilation.
 *
 *   Level 2 — Heuristic (rule-based scoring)
 *     Rubric-based scoring: checks for required sections, keyword
 *     presence, length constraints, structure validation.
 *
 *   Level 3 — LLM-as-Judge (semantic quality assessment)
 *     Uses an LLM to score output quality on a rubric. Most expensive
 *     but catches semantic issues deterministic checks miss.
 *
 * Design (from knowledge base):
 *   - First failure = first test case (fail fast)
 *   - Grades are composable: L1 → L2 → L3 cascade
 *   - Each grader returns a structured result with score + feedback
 *   - Results are saved to .eval/ JSONL for tracking over time
 */

import { existsSync, mkdirSync, appendFileSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Logger } from "../observability/logger.js";
import type { LLMClient, Message } from "../core/types.js";

export type GradeLevel = 1 | 2 | 3;

export interface GradeResult {
  passed: boolean;
  score: number;       // 0-1
  level: GradeLevel;
  feedback: string;
  details?: string[];
}

export interface EvalCase {
  id: string;
  input: string;
  expected?: string;
  rubric?: string[];
  assertions?: string[];    // regex patterns
  expectedSchema?: object;  // JSON schema for L1 check
}

export interface EvalResult {
  caseId: string;
  grades: GradeResult[];
  finalScore: number;
  passed: boolean;
  evaluatedAt: string;
}

// ============================================================
// Level 1: Deterministic Grader
// ============================================================

export class DeterministicGrader {
  /**
   * Grade output against exact match, regex, and schema checks.
   */
  grade(output: string, evalCase: EvalCase): GradeResult {
    const details: string[] = [];
    let passed = true;
    let checks = 0;
    let failures = 0;

    // Check 1: Exact match
    if (evalCase.expected !== undefined) {
      checks++;
      const normalizedOutput = output.trim();
      const normalizedExpected = evalCase.expected.trim();
      if (normalizedOutput === normalizedExpected) {
        details.push("Exact match: PASS");
      } else {
        details.push(`Exact match: FAIL (expected ${normalizedExpected.length} chars, got ${normalizedOutput.length})`);
        failures++;
        passed = false;
      }
    }

    // Check 2: Regex assertions
    if (evalCase.assertions) {
      for (const pattern of evalCase.assertions) {
        checks++;
        try {
          const regex = new RegExp(pattern);
          if (regex.test(output)) {
            details.push(`Regex /${pattern}/: PASS`);
          } else {
            details.push(`Regex /${pattern}/: FAIL`);
            failures++;
            passed = false;
          }
        } catch {
          details.push(`Regex /${pattern}/: INVALID PATTERN`);
          failures++;
          passed = false;
        }
      }
    }

    // Check 3: JSON schema validity (if expectedSchema provided)
    if (evalCase.expectedSchema) {
      checks++;
      try {
        const parsed = JSON.parse(output);
        const schemaProps = Object.keys(evalCase.expectedSchema);
        const missing = schemaProps.filter((p) => !(p in parsed));
        if (missing.length === 0) {
          details.push("JSON schema: PASS");
        } else {
          details.push(`JSON schema: FAIL (missing fields: ${missing.join(", ")})`);
          failures++;
          passed = false;
        }
      } catch {
        details.push("JSON schema: FAIL (invalid JSON)");
        failures++;
        passed = false;
      }
    }

    const score = checks > 0 ? (checks - failures) / checks : 1;

    return {
      passed,
      score: Math.round(score * 100) / 100,
      level: 1,
      feedback: passed
        ? `All ${checks} deterministic checks passed`
        : `${failures}/${checks} deterministic checks failed`,
      details,
    };
  }
}

// ============================================================
// Level 2: Heuristic Grader
// ============================================================

export class HeuristicGrader {
  /**
   * Grade output against a rubric using rule-based scoring.
   * Each rubric item is checked via keyword presence or structural rules.
   */
  grade(output: string, evalCase: EvalCase): GradeResult {
    const rubric = evalCase.rubric || [];
    if (rubric.length === 0) {
      return { passed: true, score: 1, level: 2, feedback: "No rubric items to check" };
    }

    const details: string[] = [];
    let met = 0;

    for (const item of rubric) {
      // Rubric items can be:
      //   "keyword:word" — check if word is in output
      //   "section:name" — check if section header exists
      //   "min_length:N" — check minimum character count
      //   "max_length:N" — check maximum character count

      if (item.startsWith("keyword:")) {
        const keyword = item.slice(8);
        if (output.toLowerCase().includes(keyword.toLowerCase())) {
          met++;
          details.push(`Keyword "${keyword}": FOUND`);
        } else {
          details.push(`Keyword "${keyword}": MISSING`);
        }
      } else if (item.startsWith("section:")) {
        const section = item.slice(8);
        const headerPattern = new RegExp(`^#+\\s*${section}`, "mi");
        if (headerPattern.test(output)) {
          met++;
          details.push(`Section "${section}": FOUND`);
        } else {
          details.push(`Section "${section}": MISSING`);
        }
      } else if (item.startsWith("min_length:")) {
        const min = parseInt(item.slice(11), 10);
        if (output.length >= min) {
          met++;
          details.push(`Min length ${min}: PASS (${output.length} chars)`);
        } else {
          details.push(`Min length ${min}: FAIL (${output.length} chars)`);
        }
      } else if (item.startsWith("max_length:")) {
        const max = parseInt(item.slice(11), 10);
        if (output.length <= max) {
          met++;
          details.push(`Max length ${max}: PASS (${output.length} chars)`);
        } else {
          details.push(`Max length ${max}: FAIL (${output.length} chars)`);
        }
      } else {
        // Plain text — check if it appears in output
        if (output.toLowerCase().includes(item.toLowerCase())) {
          met++;
          details.push(`Contains "${item}": YES`);
        } else {
          details.push(`Contains "${item}": NO`);
        }
      }
    }

    const score = met / rubric.length;

    return {
      passed: score >= 0.7,
      score: Math.round(score * 100) / 100,
      level: 2,
      feedback: `${met}/${rubric.length} rubric items met`,
      details,
    };
  }
}

// ============================================================
// Level 3: LLM-as-Judge Grader
// ============================================================

export class LLMJudgeGrader {
  private log = new Logger("llm-judge");

  constructor(
    private llmClientFactory: () => LLMClient,
    private model: string = "claude-sonnet-4-20250514",
  ) {}

  /**
   * Use an LLM to grade output quality against a rubric.
   * Returns a structured score extracted from the LLM response.
   */
  async grade(output: string, evalCase: EvalCase): Promise<GradeResult> {
    const rubricText = evalCase.rubric?.join("\n- ") || "General quality";
    const expectedText = evalCase.expected ? `\n\nExpected output:\n${evalCase.expected}` : "";

    const judgePrompt = `You are an evaluation judge. Grade the following output against the rubric.

Input: ${evalCase.input}
${expectedText}

Rubric:
- ${rubricText}

Output to grade:
${output}

Respond with a JSON object: {"score": 0.0-1.0, "passed": true/false, "feedback": "brief explanation"}`;

    try {
      const llm = this.llmClientFactory();
      const response = await llm.messages(
        this.model,
        "You are a precise evaluation judge. Respond only with the requested JSON.",
        [{ role: "user", content: judgePrompt } as Message],
        [],
        1024,
      );

      const text = response.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("");

      // Extract JSON from response
      const jsonMatch = text.match(/\{[^}]+\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          passed: parsed.passed ?? (parsed.score >= 0.7),
          score: Math.max(0, Math.min(1, parsed.score || 0)),
          level: 3,
          feedback: parsed.feedback || "LLM judge evaluation",
        };
      }

      // Fallback: couldn't parse response
      return {
        passed: false,
        score: 0,
        level: 3,
        feedback: "Failed to parse LLM judge response",
      };
    } catch (err) {
      this.log.error("LLM judge failed", { error: (err as Error).message });
      return {
        passed: false,
        score: 0,
        level: 3,
        feedback: `LLM judge error: ${(err as Error).message}`,
      };
    }
  }
}

// ============================================================
// Eval Runner — Orchestrates L1 → L2 → L3 cascade
// ============================================================

export class EvalRunner {
  private log = new Logger("eval");
  private evalDir: string;
  private l1 = new DeterministicGrader();
  private l2 = new HeuristicGrader();

  constructor(workspaceDir: string) {
    this.evalDir = join(workspaceDir, ".eval");
    mkdirSync(this.evalDir, { recursive: true });
  }

  /**
   * Evaluate a single case through the grader cascade.
   * L1 runs first. If it fails, L2 runs. If L2 is inconclusive, L3 runs.
   */
  async evaluate(
    output: string,
    evalCase: EvalCase,
    llmJudge?: LLMJudgeGrader,
  ): Promise<EvalResult> {
    const grades: GradeResult[] = [];

    // Level 1: Deterministic
    const l1Result = this.l1.grade(output, evalCase);
    grades.push(l1Result);

    // Level 2: Heuristic (run if L1 has rubric items or L1 failed)
    if (!l1Result.passed || evalCase.rubric) {
      const l2Result = this.l2.grade(output, evalCase);
      grades.push(l2Result);

      // Level 3: LLM Judge (run if L2 is inconclusive and LLM judge available)
      if (!l2Result.passed && llmJudge) {
        const l3Result = await llmJudge.grade(output, evalCase);
        grades.push(l3Result);
      }
    }

    // Final score: average of all grades
    const finalScore = grades.reduce((sum, g) => sum + g.score, 0) / grades.length;

    const result: EvalResult = {
      caseId: evalCase.id,
      grades,
      finalScore: Math.round(finalScore * 100) / 100,
      passed: grades.every((g) => g.passed),
      evaluatedAt: new Date().toISOString(),
    };

    this.save(result);
    return result;
  }

  /** Run a batch of eval cases */
  async evaluateBatch(
    outputs: Map<string, string>,
    cases: EvalCase[],
    llmJudge?: LLMJudgeGrader,
  ): Promise<EvalResult[]> {
    const results: EvalResult[] = [];
    for (const evalCase of cases) {
      const output = outputs.get(evalCase.id) || "";
      results.push(await this.evaluate(output, evalCase, llmJudge));
    }
    return results;
  }

  /** List all eval results */
  listResults(): EvalResult[] {
    if (!existsSync(this.evalDir)) return [];
    const results: EvalResult[] = [];
    for (const file of readdirSync(this.evalDir)) {
      if (!file.endsWith(".jsonl")) continue;
      try {
        const content = readFileSync(join(this.evalDir, file), "utf-8");
        for (const line of content.split("\n")) {
          if (line.trim()) results.push(JSON.parse(line));
        }
      } catch {
        // skip
      }
    }
    return results.sort((a, b) => b.evaluatedAt.localeCompare(a.evaluatedAt));
  }

  private save(result: EvalResult): void {
    const filePath = join(this.evalDir, "results.jsonl");
    appendFileSync(filePath, `${JSON.stringify(result)}\n`, "utf-8");
    this.log.info(`Eval: case ${result.caseId} — score ${result.finalScore}, passed ${result.passed}`);
  }
}
