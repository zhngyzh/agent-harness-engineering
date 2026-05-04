/**
 * Agent Loop
 *
 * The entire secret of an AI coding agent in one pattern:
 *
 *   while stop_reason === "tool_use":
 *     response = LLM(messages, tools)
 *     execute tools
 *     append results
 *
 * This is the core loop. Production agents layer policy, hooks,
 * and lifecycle controls on top — but the loop itself stays stable.
 *
 * Design principles:
 * - The loop NEVER changes. New capabilities are added externally.
 * - Model handles reasoning; external system handles state and boundaries.
 * - Every tool error is caught and fed back to the model for self-repair.
 */

import type {
  AgentConfig,
  AgentEvent,
  EventHandler,
  LLMClient,
  Message,
  MessageContent,
  ToolDefinition,
} from "./types.js";
import { DEFAULT_CONFIG } from "./types.js";
import { ToolRegistry, createDefaultRegistry } from "./tool-registry.js";
import { SessionStore } from "./session.js";
import { EventBus } from "../observability/events.js";
import { Tracing } from "../observability/tracing.js";

export interface AgentLoopOptions {
  config?: Partial<AgentConfig>;
  llm?: LLMClient;
  tools?: ToolRegistry;
  session?: SessionStore;
  eventBus?: EventBus;
  tracing?: Tracing;
}

export class AgentLoop {
  readonly config: AgentConfig;
  readonly llm: LLMClient;
  readonly tools: ToolRegistry;
  readonly session: SessionStore;
  readonly events: EventBus;
  readonly tracing: Tracing;

  private messages: Message[] = [];
  private turnCount = 0;
  private eventHandlers: EventHandler[] = [];
  private aborted = false;

  constructor(options: AgentLoopOptions = {}) {
    this.config = { ...DEFAULT_CONFIG, ...options.config };
    this.llm = options.llm!;
    this.tools = options.tools || createDefaultRegistry();
    this.session = options.session || new SessionStore(this.config.workspaceDir);
    this.events = options.eventBus || new EventBus();
    this.tracing = options.tracing || new Tracing(this.session.sessionId);

    // Wire up event -> tracing
    this.events.on((event) => {
      if (event.type === "tool_start" || event.type === "tool_end" || event.type === "tool_error") {
        this.tracing.addToolSpan(event);
      }
    });
  }

  /** Register an event handler */
  onEvent(handler: EventHandler): () => void {
    this.eventHandlers.push(handler);
    return () => {
      const idx = this.eventHandlers.indexOf(handler);
      if (idx !== -1) this.eventHandlers.splice(idx, 1);
    };
  }

  /** Send a user message and run the agent loop */
  async sendMessage(userInput: string, systemPrompt: string): Promise<string> {
    this.aborted = false;
    this.turnCount = 0;

    // Append user message
    this.messages.push({ role: "user", content: [{ type: "text", text: userInput }] });

    this.emit("agent_start", { input: userInput });

    let finalText = "";

    while (this.turnCount < this.config.maxTurns) {
      if (this.aborted) {
        this.emit("error", { reason: "aborted" });
        break;
      }

      this.turnCount++;
      this.emit("turn_start", { turn: this.turnCount });

      // Call LLM
      const response = await this.callLLM(systemPrompt);

      // Accumulate token usage in trace
      this.tracing.addTokens(response.usage?.inputTokens || 0, response.usage?.outputTokens || 0);

      // Persist assistant message
      const assistantMsg: Message = {
        role: "assistant",
        content: response.content,
      };
      this.messages.push(assistantMsg);

      // Check stop reason
      if (response.stopReason === "end_turn" || response.stopReason === "stop_sequence") {
        finalText = this.extractText(response.content);
        this.emit("agent_end", { turns: this.turnCount, finalText });
        break;
      }

      if (response.stopReason === "max_tokens") {
        this.emit("error", { reason: "max_tokens", turn: this.turnCount });
        finalText = this.extractText(response.content);
        break;
      }

      // Handle tool use
      if (response.stopReason === "tool_use") {
        const toolResults = await this.executeTools(response.content);
        this.messages.push({ role: "user", content: toolResults });
        continue;
      }
    }

    if (this.turnCount >= this.config.maxTurns) {
      this.emit("error", { reason: "max_turns", maxTurns: this.config.maxTurns });
      finalText = this.messages
        .filter((m) => m.role === "assistant")
        .map((m) => this.extractText(Array.isArray(m.content) ? m.content : [{ type: "text", text: m.content }]))
        .join("\n");
    }

    // Persist session
    await this.session.appendMessages(this.messages);

    return finalText || "(no response)";
  }

  /** Abort the current loop */
  abort(): void {
    this.aborted = true;
  }

  /** Get current message history */
  getMessages(): ReadonlyArray<Message> {
    return this.messages;
  }

  /** Reset message history (new conversation) */
  reset(): void {
    this.messages = [];
    this.turnCount = 0;
  }

  // ============================================================
  // Private
  // ============================================================

  private async callLLM(systemPrompt: string) {
    const toolDefs: ToolDefinition[] = this.tools.definitions();

    // Split system prompt at cache boundary for prefix caching
    const finalSystem = systemPrompt; // Cache optimization in Phase 2

    return this.llm.messages(
      this.config.model,
      finalSystem,
      [...this.messages],
      toolDefs,
      this.config.maxTokens,
    );
  }

  private async executeTools(content: MessageContent[]) {
    const toolUses = content.filter((c): c is MessageContent & { type: "tool_use" } => c.type === "tool_use");
    const results = await Promise.all(
      toolUses.map(async (toolUse) => {
        this.emit("tool_start", { tool: toolUse.name, input: toolUse.input });
        try {
          const output = await this.tools.execute(toolUse.name, toolUse.input as Record<string, unknown>);
          this.emit("tool_end", { tool: toolUse.name, outputLength: output.length });
          return {
            type: "tool_result" as const,
            tool_use_id: toolUse.id,
            content: output,
          };
        } catch (err) {
          const error = err as Error;
          this.emit("tool_error", { tool: toolUse.name, error: error.message });
          return {
            type: "tool_result" as const,
            tool_use_id: toolUse.id,
            content: `Error: ${error.message}`,
            is_error: true,
          };
        }
      }),
    );
    return results;
  }

  private extractText(content: MessageContent[]): string {
    return content
      .filter((c): c is MessageContent & { type: "text" } => c.type === "text")
      .map((c) => c.text)
      .join("\n");
  }

  private emit(type: AgentEvent["type"], data: Record<string, unknown> = {}) {
    const event: AgentEvent = {
      type,
      sessionId: this.session.sessionId,
      timestamp: new Date().toISOString(),
      data,
    };
    this.events.emit(event);
    for (const handler of this.eventHandlers) {
      handler(event);
    }
  }
}
