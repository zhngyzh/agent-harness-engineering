/**
 * Hook System
 *
 * Deterministic logic that runs at specific points in the agent lifecycle
 * without going through the LLM context. This is the "plumbing" layer
 * that enforces rules efficiently.
 *
 * Hook points:
 *   - before_tool_call: validate/modify tool inputs
 *   - after_tool_call: validate/modify tool outputs
 *   - before_message: validate/modify outgoing messages
 *   - after_message: process incoming messages
 *   - before_compact: decide what to keep during compaction
 *   - on_error: handle errors deterministically
 *
 * Design principles:
 *   - Hooks are deterministic — no LLM calls
 *   - Hooks can block, modify, or pass through
 *   - Order matters: hooks run in registration order
 *   - Fail secure: errors in hooks default to blocking
 *   - All hook executions are logged
 */

import { existsSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { Logger } from "../observability/logger.js";

export type HookPoint =
  | "before_tool_call"
  | "after_tool_call"
  | "before_message"
  | "after_message"
  | "before_compact"
  | "on_error";

export type HookAction = "allow" | "block" | "modify";

export interface HookContext {
  toolName?: string;
  input?: Record<string, unknown>;
  output?: string;
  message?: string;
  error?: Error;
  metadata?: Record<string, unknown>;
}

export interface HookResult {
  action: HookAction;
  modifiedInput?: Record<string, unknown>;
  modifiedOutput?: string;
  modifiedMessage?: string;
  reason?: string;
}

export type HookHandler = (context: HookContext) => HookResult | Promise<HookResult>;

export interface Hook {
  id: string;
  point: HookPoint;
  handler: HookHandler;
  priority: number;  // lower = runs first
  enabled: boolean;
  description?: string;
}

export interface HookExecution {
  hookId: string;
  point: HookPoint;
  action: HookAction;
  durationMs: number;
  reason?: string;
  timestamp: string;
}

export class HookSystem {
  private log = new Logger("hooks");
  private hooks = new Map<HookPoint, Hook[]>();
  private auditDir: string;
  private counter = 0;

  constructor(workspaceDir: string) {
    this.auditDir = join(workspaceDir, ".security");
    mkdirSync(this.auditDir, { recursive: true });

    // Initialize hook point arrays
    for (const point of [
      "before_tool_call", "after_tool_call", "before_message",
      "after_message", "before_compact", "on_error",
    ] as HookPoint[]) {
      this.hooks.set(point, []);
    }
  }

  /**
   * Register a hook at a specific point.
   */
  register(hook: Omit<Hook, "id">): Hook {
    const fullHook: Hook = {
      ...hook,
      id: `hook-${++this.counter}`,
    };

    const pointHooks = this.hooks.get(hook.point) || [];
    pointHooks.push(fullHook);
    pointHooks.sort((a, b) => a.priority - b.priority);
    this.hooks.set(hook.point, pointHooks);

    this.log.info(`Hook registered: ${fullHook.id} at ${hook.point} (priority ${hook.priority})`);
    return fullHook;
  }

  /**
   * Unregister a hook by ID.
   */
  unregister(hookId: string): boolean {
    for (const [point, pointHooks] of this.hooks) {
      const idx = pointHooks.findIndex((h) => h.id === hookId);
      if (idx !== -1) {
        pointHooks.splice(idx, 1);
        this.log.info(`Hook unregistered: ${hookId}`);
        return true;
      }
    }
    return false;
  }

  /**
   * Enable or disable a hook.
   */
  setEnabled(hookId: string, enabled: boolean): boolean {
    for (const pointHooks of this.hooks.values()) {
      const hook = pointHooks.find((h) => h.id === hookId);
      if (hook) {
        hook.enabled = enabled;
        return true;
      }
    }
    return false;
  }

  /**
   * Execute all hooks at a given point.
   * Returns the final result after all hooks have run.
   * If any hook blocks, execution stops immediately.
   */
  async execute(point: HookPoint, context: HookContext): Promise<HookResult> {
    const pointHooks = this.hooks.get(point) || [];
    const executions: HookExecution[] = [];

    let currentContext = { ...context };
    let finalResult: HookResult = { action: "allow" };

    for (const hook of pointHooks) {
      if (!hook.enabled) continue;

      const startTime = Date.now();
      try {
        const result = await hook.handler(currentContext);
        const durationMs = Date.now() - startTime;

        executions.push({
          hookId: hook.id,
          point,
          action: result.action,
          durationMs,
          reason: result.reason,
          timestamp: new Date().toISOString(),
        });

        if (result.action === "block") {
          finalResult = { action: "block", reason: result.reason };
          this.log.warn(`Hook blocked: ${hook.id} at ${point} — ${result.reason}`);
          break;
        }

        if (result.action === "modify") {
          if (result.modifiedInput) currentContext.input = result.modifiedInput;
          if (result.modifiedOutput) currentContext.output = result.modifiedOutput;
          if (result.modifiedMessage) currentContext.message = result.modifiedMessage;
          finalResult = result;
        }
      } catch (err) {
        const durationMs = Date.now() - startTime;
        executions.push({
          hookId: hook.id,
          point,
          action: "block",
          durationMs,
          reason: `Hook error: ${(err as Error).message}`,
          timestamp: new Date().toISOString(),
        });

        // Fail secure: hook error blocks
        finalResult = { action: "block", reason: `Hook error: ${(err as Error).message}` };
        this.log.error(`Hook error: ${hook.id} at ${point}`, { error: (err as Error).message });
        break;
      }
    }

    // Audit executions
    for (const exec of executions) {
      this.audit(exec);
    }

    return finalResult;
  }

  /** List all registered hooks */
  listHooks(point?: HookPoint): Hook[] {
    if (point) {
      return [...(this.hooks.get(point) || [])];
    }
    const all: Hook[] = [];
    for (const pointHooks of this.hooks.values()) {
      all.push(...pointHooks);
    }
    return all;
  }

  /** Clear all hooks */
  clear(): void {
    for (const point of this.hooks.keys()) {
      this.hooks.set(point, []);
    }
    this.log.info("All hooks cleared");
  }

  // ============================================================
  // Private
  // ============================================================

  private audit(execution: HookExecution): void {
    const today = new Date().toISOString().slice(0, 10);
    const filePath = join(this.auditDir, `hooks-${today}.jsonl`);
    appendFileSync(filePath, `${JSON.stringify(execution)}\n`, "utf-8");
  }
}
