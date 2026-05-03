/**
 * Self-Review (Background Fork)
 *
 * After a session completes, spawns a background subagent to review
 * the conversation trace for errors, inefficiencies, and learning
 * opportunities. Inspired by Hermes' self-reflection mechanism.
 *
 * Review dimensions:
 *   1. Tool usage correctness — were tools called with right params?
 *   2. Context efficiency — was context used well, or wasted?
 *   3. Error recovery — how did the agent handle failures?
 *   4. Learning signals — what patterns should be saved to memory/skills?
 *
 * Output: a structured review report saved to .reviews/ JSONL.
 * High-priority findings trigger nudges (see nudge.ts).
 */

import { existsSync, mkdirSync, appendFileSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Logger } from "../observability/logger.js";
import type { AgentEvent } from "../core/types.js";
import type { ToolSpan } from "../observability/tracing.js";

export interface ReviewFinding {
  dimension: "tool_usage" | "context_efficiency" | "error_recovery" | "learning_signal";
  severity: "info" | "warning" | "critical";
  description: string;
  suggestion?: string;
}

export interface ReviewReport {
  id: string;
  sessionId: string;
  reviewedAt: string;
  findings: ReviewFinding[];
  summary: string;
  score: number; // 0-1 quality score
}

/**
 * Rule-based self-review analyzer.
 * Analyzes a trace (tool spans + events) and produces findings.
 * This is the deterministic layer; LLM-based review can be layered on top.
 */
export class SelfReviewAnalyzer {
  private log = new Logger("self-review");
  private reviewDir: string;
  private counter = 0;

  constructor(workspaceDir: string) {
    this.reviewDir = join(workspaceDir, ".reviews");
    mkdirSync(this.reviewDir, { recursive: true });
  }

  /**
   * Analyze a session trace and produce a review report.
   * Deterministic rules — no LLM needed.
   */
  analyze(
    sessionId: string,
    toolSpans: ToolSpan[],
    events: AgentEvent[],
  ): ReviewReport {
    const findings: ReviewFinding[] = [];

    // Rule 1: Tool error rate
    const errorSpans = toolSpans.filter((s) => s.error);
    if (toolSpans.length > 0) {
      const errorRate = errorSpans.length / toolSpans.length;
      if (errorRate > 0.3) {
        findings.push({
          dimension: "tool_usage",
          severity: "warning",
          description: `High tool error rate: ${errorSpans.length}/${toolSpans.length} failed`,
          suggestion: "Review tool input schemas and add validation",
        });
      } else if (errorRate > 0) {
        findings.push({
          dimension: "tool_usage",
          severity: "info",
          description: `Some tool errors: ${errorSpans.length}/${toolSpans.length} failed`,
        });
      }
    }

    // Rule 2: Slow tool calls (> 10s)
    const slowSpans = toolSpans.filter(
      (s) => s.durationMs && s.durationMs > 10_000,
    );
    for (const span of slowSpans) {
      findings.push({
        dimension: "context_efficiency",
        severity: "warning",
        description: `Slow tool call: ${span.tool} took ${span.durationMs}ms`,
        suggestion: "Consider batching or optimizing this tool call",
      });
    }

    // Rule 3: Repeated identical tool calls (possible loop)
    const toolCallCounts = new Map<string, number>();
    for (const span of toolSpans) {
      toolCallCounts.set(span.tool, (toolCallCounts.get(span.tool) || 0) + 1);
    }
    for (const [tool, count] of toolCallCounts) {
      if (count > 5) {
        findings.push({
          dimension: "context_efficiency",
          severity: "warning",
          description: `Tool "${tool}" called ${count} times — possible loop`,
          suggestion: "Add loop detection or reduce max turns",
        });
      }
    }

    // Rule 4: Error recovery — check if errors were followed by success
    for (let i = 0; i < toolSpans.length - 1; i++) {
      if (toolSpans[i].error && !toolSpans[i + 1].error) {
        findings.push({
          dimension: "error_recovery",
          severity: "info",
          description: `Recovered from ${toolSpans[i].tool} error on next call`,
        });
      }
    }

    // Rule 5: Learning signals — tool patterns worth saving
    const uniqueTools = new Set(toolSpans.map((s) => s.tool));
    if (uniqueTools.size >= 3 && toolSpans.length >= 5) {
      findings.push({
        dimension: "learning_signal",
        severity: "info",
        description: `Complex workflow detected: ${[...uniqueTools].join(", ")}`,
        suggestion: "Consider creating a Skill for this workflow pattern",
      });
    }

    // Compute quality score
    const criticalCount = findings.filter((f) => f.severity === "critical").length;
    const warningCount = findings.filter((f) => f.severity === "warning").length;
    const score = Math.max(0, 1 - criticalCount * 0.3 - warningCount * 0.1);

    const report: ReviewReport = {
      id: `review-${Date.now()}-${++this.counter}`,
      sessionId,
      reviewedAt: new Date().toISOString(),
      findings,
      summary: this.generateSummary(findings, toolSpans.length, score),
      score: Math.round(score * 100) / 100,
    };

    this.save(report);
    return report;
  }

  /** List all review reports */
  listReports(): ReviewReport[] {
    if (!existsSync(this.reviewDir)) return [];
    const reports: ReviewReport[] = [];
    for (const file of readdirSync(this.reviewDir)) {
      if (!file.endsWith(".json")) continue;
      try {
        const content = readFileSync(join(this.reviewDir, file), "utf-8");
        for (const line of content.split("\n")) {
          if (line.trim()) {
            reports.push(JSON.parse(line));
          }
        }
      } catch {
        // skip corrupted
      }
    }
    return reports.sort((a, b) => {
      const cmp = b.reviewedAt.localeCompare(a.reviewedAt);
      return cmp !== 0 ? cmp : b.id.localeCompare(a.id);
    });
  }

  /** Get the latest report */
  getLatest(): ReviewReport | null {
    const reports = this.listReports();
    return reports[0] || null;
  }

  // ============================================================
  // Private
  // ============================================================

  private generateSummary(findings: ReviewFinding[], totalTools: number, score: number): string {
    if (findings.length === 0) {
      return `Clean session: ${totalTools} tool calls, no issues detected. Score: ${score}`;
    }
    const parts = findings.map((f) => `[${f.severity}] ${f.description}`);
    return `Review: ${findings.length} findings across ${totalTools} tool calls. Score: ${score}\n${parts.join("\n")}`;
  }

  private save(report: ReviewReport): void {
    const filePath = join(this.reviewDir, `${report.id}.json`);
    appendFileSync(filePath, `${JSON.stringify(report)}\n`, "utf-8");
    this.log.info(`Review saved: ${report.id} (score: ${report.score}, findings: ${report.findings.length})`);
  }
}
