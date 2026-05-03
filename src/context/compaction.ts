/**
 * Context Compaction — Three-Layer Strategy
 *
 * Layer 1: Micro-compact (every turn)
 *   - Truncate long tool results
 *   - Remove redundant whitespace
 *   - Runs automatically before each LLM call
 *
 * Layer 2: Auto-compact (threshold-based)
 *   - Triggered when context usage exceeds COMPACTION_THRESHOLD (85%)
 *   - Summarizes older messages via LLM
 *   - Targets COMPACTION_TARGET (50%) of current usage
 *
 * Layer 3: Manual compact (user-triggered)
 *   - /compact command
 *   - Same as auto but user-initiated
 *
 * Design principle: Compaction creates a summary + keeps recent messages.
 * The summary preserves key facts, decisions, and tool call outcomes.
 */

import type { Message, LLMClient } from "../core/types.js";
import type { CompactRecord } from "../core/types.js";
import { COMPACTION_THRESHOLD, MICRO_COMPACT_TRUNCATE_CHARS } from "../core/constants.js";
import { Logger } from "../observability/logger.js";

export interface CompactionResult {
  messages: Message[];
  compacted: boolean;
  record?: CompactRecord;
}

// ============================================================
// Layer 1: Micro-Compact
// ============================================================

/**
 * Truncate long tool results in-place.
 * Runs every turn before LLM call.
 */
export function microCompact(messages: Message[]): Message[] {
  return messages.map((msg) => {
    if (typeof msg.content === "string") {
      return msg;
    }

    return {
      ...msg,
      content: msg.content.map((block) => {
        if (block.type === "tool_result" && block.content.length > MICRO_COMPACT_TRUNCATE_CHARS) {
          return {
            ...block,
            content:
              block.content.slice(0, MICRO_COMPACT_TRUNCATE_CHARS) +
              `\n... (truncated ${block.content.length} → ${MICRO_COMPACT_TRUNCATE_CHARS} chars)`,
          };
        }
        return block;
      }),
    };
  });
}

// ============================================================
// Layer 2 & 3: Auto / Manual Compact
// ============================================================

export class ContextCompactor {
  private log = new Logger("compaction");

  constructor(
    private llm: LLMClient,
    private model: string,
    _maxTokens: number,
  ) {}

  /**
   * Check if compaction should be triggered.
   * Uses a simple token estimate (chars / 4).
   */
  shouldCompact(messages: Message[], maxContextTokens: number): boolean {
    const estimatedTokens = this.estimateTokens(messages);
    const ratio = estimatedTokens / maxContextTokens;
    return ratio >= COMPACTION_THRESHOLD;
  }

  /**
   * Compact messages by summarizing older ones.
   * Keeps the first message (user context) and last N messages intact.
   */
  async compact(
    messages: Message[],
    reason: "auto" | "manual" = "auto",
  ): Promise<CompactionResult> {
    if (messages.length <= 4) {
      this.log.info("Too few messages to compact");
      return { messages, compacted: false };
    }

    const messagesBefore = messages.length;

    // Strategy: summarize the middle portion, keep first 2 and last 2
    const keepStart = 2;
    const keepEnd = 2;
    const toSummarize = messages.slice(keepStart, messages.length - keepEnd);
    const keepFirst = messages.slice(0, keepStart);
    const keepLast = messages.slice(-keepEnd);

    this.log.info(`Compacting ${toSummarize.length} messages (${reason})`);

    // Generate summary via LLM
    const summary = await this.summarize(toSummarize);

    // Build compacted message list
    const summaryMessage: Message = {
      role: "user",
      content: [
        {
          type: "text",
          text: `[Context compacted — summary of ${toSummarize.length} messages]\n\n${summary}`,
        },
      ],
    };

    const compactedMessages = [...keepFirst, summaryMessage, ...keepLast];

    const record: CompactRecord = {
      reason,
      messagesBefore,
      messagesAfter: compactedMessages.length,
      summary: summary.slice(0, 200),
    };

    this.log.info(
      `Compaction complete: ${messagesBefore} → ${compactedMessages.length} messages`,
    );

    return { messages: compactedMessages, compacted: true, record };
  }

  // ============================================================
  // Private
  // ============================================================

  private async summarize(messages: Message[]): Promise<string> {
    const summaryPrompt =
      "Summarize the following conversation concisely. " +
      "Preserve: key facts, decisions made, tool call outcomes, file paths, errors encountered. " +
      "Be brief — aim for 200-400 words.\n\n" +
      messages.map((m) => this.messageToText(m)).join("\n---\n");

    try {
      const response = await this.llm.messages(
        this.model,
        "You are a summarization assistant. Be concise and factual.",
        [{ role: "user", content: [{ type: "text", text: summaryPrompt }] }],
        [],
        1024,
      );

      const textBlocks = response.content.filter((c) => c.type === "text");
      return textBlocks.map((c) => (c as { type: "text"; text: string }).text).join("\n");
    } catch (err) {
      this.log.error("Summarization failed, using fallback", { error: (err as Error).message });
      return `Summary: ${messages.length} messages including ${messages.filter((m) => m.role === "assistant").length} assistant responses.`;
    }
  }

  private messageToText(msg: Message): string {
    const content = Array.isArray(msg.content)
      ? msg.content
          .map((c) => {
            if (c.type === "text") return c.text;
            if (c.type === "tool_use") return `[Tool: ${c.name}]`;
            if (c.type === "tool_result") return `[Result: ${c.content.slice(0, 200)}]`;
            return "";
          })
          .join(" ")
      : msg.content;
    return `${msg.role}: ${content}`;
  }

  private estimateTokens(messages: Message[]): number {
    // Rough estimate: 1 token ≈ 4 characters
    const text = messages
      .map((m) => {
        if (typeof m.content === "string") return m.content;
        return m.content.map((c) => (c.type === "text" ? c.text : "")).join(" ");
      })
      .join(" ");
    return Math.ceil(text.length / 4);
  }
}
