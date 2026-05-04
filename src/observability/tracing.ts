/**
 * Tracing
 *
 * Records a complete trace of agent execution for observability.
 * Every run records: full messages[], all tool calls + results,
 * reasoning chain, final output, token usage, latency.
 *
 * Supports semantic retrieval (find traces where agent confused two tools).
 */

import type { AgentEvent } from "../core/types.js";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface ToolSpan {
  tool: string;
  input: Record<string, unknown>;
  output?: string;
  error?: string;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
}

export interface Trace {
  id: string;
  sessionId: string;
  startedAt: string;
  endedAt?: string;
  toolSpans: ToolSpan[];
  events: AgentEvent[];
  totalTokens: number;
}

export class Tracing {
  private trace: Trace;
  private traceDir: string;

  constructor(sessionId: string, workspaceDir: string = "./workspace") {
    this.traceDir = join(workspaceDir, ".traces");
    mkdirSync(this.traceDir, { recursive: true });

    this.trace = {
      id: `trace-${Date.now()}`,
      sessionId,
      startedAt: new Date().toISOString(),
      toolSpans: [],
      events: [],
      totalTokens: 0,
    };
  }

  addEvent(event: AgentEvent): void {
    this.trace.events.push(event);
  }

  addToolSpan(event: AgentEvent): void {
    if (event.type === "tool_start") {
      this.trace.toolSpans.push({
        tool: event.data.tool as string,
        input: (event.data.input as Record<string, unknown>) || {},
        startedAt: event.timestamp,
      });
    } else if (event.type === "tool_end" || event.type === "tool_error") {
      const span = this.trace.toolSpans.find(
        (s) => s.tool === event.data.tool && !s.endedAt,
      );
      if (span) {
        span.endedAt = event.timestamp;
        span.durationMs = new Date(span.endedAt).getTime() - new Date(span.startedAt).getTime();
        if (event.type === "tool_error") {
          span.error = event.data.error as string;
        }
      }
    }
  }

  /** Record token usage for the current trace */
  addTokens(inputTokens: number, outputTokens: number): void {
    this.trace.totalTokens += inputTokens + outputTokens;
  }

  save(): void {
    this.trace.endedAt = new Date().toISOString();
    const filePath = join(this.traceDir, `${this.trace.id}.json`);
    writeFileSync(filePath, JSON.stringify(this.trace, null, 2));
  }

  getTrace(): Readonly<Trace> {
    return this.trace;
  }

  /** Find traces matching a semantic query (simple keyword search) */
  static searchTraces(workspaceDir: string, query: string): Trace[] {
    const traceDir = join(workspaceDir, ".traces");
    if (!existsSync(traceDir)) return [];

    const results: Trace[] = [];
    const keywords = query.toLowerCase().split(/\s+/);

    for (const file of readdirSync(traceDir)) {
      if (!file.endsWith(".json")) continue;
      const content = readFileSync(join(traceDir, file), "utf-8");
      const trace: Trace = JSON.parse(content);
      const traceText = JSON.stringify(trace).toLowerCase();

      if (keywords.every((kw) => traceText.includes(kw))) {
        results.push(trace);
      }
    }

    return results;
  }
}

