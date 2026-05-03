/**
 * Subagent Isolation
 *
 * Spawns an isolated agent instance with a fresh messages[] array.
 * The subagent works independently and returns a summary to the parent.
 *
 * Design (from learn-claude-code s04):
 *   - Fresh messages[] per subagent (no parent context leakage)
 *   - Summary-only return (not full transcript)
 *   - Configurable max turns
 *   - Subagent cannot spawn further subagents (prevents runaway recursion)
 */

import { randomUUID } from "node:crypto";
import type { AgentConfig, LLMClient, Message } from "../core/types.js";
import { AgentLoop } from "../core/agent-loop.js";
import { EventBus } from "../observability/events.js";
import { Logger } from "../observability/logger.js";

export interface SubagentResult {
  id: string;
  status: "completed" | "failed" | "timeout";
  summary: string;
  turns: number;
  durationMs: number;
  error?: string;
}

export interface SubagentOptions {
  task: string;
  systemPrompt?: string;
  maxTurns?: number;
  timeoutMs?: number;
}

export class SubagentManager {
  private log = new Logger("subagent");
  private activeSubagents = new Map<string, AbortController>();

  constructor(
    private llmClientFactory: () => LLMClient,
    private defaultSystemPrompt: string,
  ) {}

  /**
   * Spawn a subagent to work on a task.
   * Returns a Promise that resolves with the subagent's summary.
   */
  async spawn(options: SubagentOptions): Promise<SubagentResult> {
    const id = `subagent-${randomUUID().slice(0, 8)}`;
    const abortController = new AbortController();
    this.activeSubagents.set(id, abortController);

    const startTime = Date.now();
    this.log.info(`Subagent spawned: ${id} — ${options.task.slice(0, 80)}`);

    try {
      const result = await this.runSubagent(id, options, abortController.signal);
      result.durationMs = Date.now() - startTime;
      this.log.info(`Subagent completed: ${id} (${result.turns} turns, ${result.durationMs}ms)`);
      return result;
    } catch (err) {
      const durationMs = Date.now() - startTime;
      this.log.error(`Subagent failed: ${id}`, { error: (err as Error).message });
      return {
        id,
        status: "failed",
        summary: "",
        turns: 0,
        durationMs,
        error: (err as Error).message,
      };
    } finally {
      this.activeSubagents.delete(id);
    }
  }

  /** Abort a running subagent */
  abort(id: string): boolean {
    const controller = this.activeSubagents.get(id);
    if (controller) {
      controller.abort();
      this.log.info(`Subagent aborted: ${id}`);
      return true;
    }
    return false;
  }

  /** Abort all active subagents */
  abortAll(): void {
    for (const [id, controller] of this.activeSubagents) {
      controller.abort();
      this.log.info(`Subagent aborted: ${id}`);
    }
  }

  // ============================================================
  // Private
  // ============================================================

  private async runSubagent(
    id: string,
    options: SubagentOptions,
    signal: AbortSignal,
  ): Promise<SubagentResult> {
    const systemPrompt = options.systemPrompt || this.defaultSystemPrompt;
    const maxTurns = options.maxTurns || 20;
    const timeoutMs = options.timeoutMs || 120_000; // 2 min default

    // Create isolated agent loop
    const llm = this.llmClientFactory();
    const loop = new AgentLoop({
      config: {
        name: id,
        model: "claude-sonnet-4-20250514",
        maxTokens: 4096,
        maxTurns,
        maxContextTokens: 50_000,
        language: "zh",
        channel: "cli" as const,
        workspaceDir: "./workspace",
        temperature: 0.3,
      },
      llm,
      eventBus: new EventBus(),
    });

    // Set up timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Subagent timeout")), timeoutMs);
    });

    // Set up abort
    const abortPromise = new Promise<never>((_, reject) => {
      signal.addEventListener("abort", () => reject(new Error("Subagent aborted")));
    });

    // Run the subagent
    const runPromise = loop.sendMessage(options.task, systemPrompt);

    const response = await Promise.race([runPromise, timeoutPromise, abortPromise]);

    const messages = loop.getMessages();
    const turns = messages.filter((m) => m.role === "assistant").length;

    // Generate summary
    const summary = await this.summarize(response);

    return {
      id,
      status: "completed",
      summary,
      turns,
      durationMs: 0, // Set by caller
    };
  }

  private async summarize(response: string): Promise<string> {
    // If response is short enough, use it directly
    if (response.length <= 500) return response;
    // Otherwise truncate with indicator
    return response.slice(0, 500) + "\n... (truncated)";
  }
}
