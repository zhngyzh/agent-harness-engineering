/**
 * System Prompt Builder
 *
 * Assembles the system prompt from 8 layers:
 *
 *   Layer 1: Identity        — Who the agent is
 *   Layer 2: Soul            — Personality and communication style
 *   Layer 3: Tools           — Available tools and usage guidelines
 *   Layer 4: Skills          — On-demand loaded skill summaries
 *   Layer 5: Memory          — Relevant recalled memories
 *   Layer 6: Bootstrap       — Workspace files (BOOTSTRAP.md, AGENTS.md, etc.)
 *   Layer 7: Runtime         — Current time, channel, session info
 *   Layer 8: Channel         — Channel-specific instructions
 *
 * Static vs Dynamic split:
 *   Layers 1-3 are static → can be cached (prefix cache)
 *   Layers 4-8 are dynamic → change per session/turn
 *
 * The CACHE_BOUNDARY marker tells the LLM provider where the cacheable
 * prefix ends and dynamic content begins.
 */

import type { BootstrapResult } from "./bootstrap.js";
import { CACHE_BOUNDARY } from "../core/constants.js";
import { Logger } from "../observability/logger.js";

export interface SkillSummary {
  name: string;
  description: string;
}

export interface MemoryEntry {
  content: string;
  score: number;
}

export interface RuntimeInfo {
  currentTime: string;
  channel: string;
  sessionId: string;
  language: string;
}

export interface SystemPromptLayers {
  identity?: string;
  soul?: string;
  tools?: string;
  skills?: SkillSummary[];
  memories?: MemoryEntry[];
  bootstrap?: BootstrapResult;
  runtime?: RuntimeInfo;
  channel?: string;
}

export class SystemPromptBuilder {
  private log = new Logger("prompt-builder");

  /**
   * Build the complete system prompt from layers.
   * Returns a prompt with the cache boundary marker.
   */
  build(layers: SystemPromptLayers): string {
    const staticParts: string[] = [];
    const dynamicParts: string[] = [];

    // === Static Layers (cacheable) ===

    // Layer 1: Identity
    if (layers.identity) {
      staticParts.push("## Identity\n" + layers.identity);
    }

    // Layer 2: Soul
    if (layers.soul) {
      staticParts.push("## Communication Style\n" + layers.soul);
    }

    // Layer 3: Tools
    if (layers.tools) {
      staticParts.push("## Available Tools\n" + layers.tools);
    }

    // Cache boundary marker
    staticParts.push(CACHE_BOUNDARY);

    // === Dynamic Layers (per-session) ===

    // Layer 4: Skills (summaries only — full content loaded on demand)
    if (layers.skills && layers.skills.length > 0) {
      const skillLines = layers.skills.map(
        (s) => `- **${s.name}**: ${s.description}`,
      );
      dynamicParts.push("## Available Skills\n" + skillLines.join("\n"));
      dynamicParts.push(
        "Use the load_skill tool to load a skill's full instructions when needed.",
      );
    }

    // Layer 5: Memory (relevant recalled memories)
    if (layers.memories && layers.memories.length > 0) {
      const memLines = layers.memories.map((m) => `- ${m.content}`);
      dynamicParts.push("## Relevant Memories\n" + memLines.join("\n"));
    }

    // Layer 6: Bootstrap (workspace files)
    if (layers.bootstrap) {
      for (const file of layers.bootstrap.files) {
        dynamicParts.push(`## ${file.name.replace(".md", "").toUpperCase()}\n${file.content}`);
      }
    }

    // Layer 7: Runtime
    if (layers.runtime) {
      dynamicParts.push(
        `## Runtime Context\n` +
          `- Current time: ${layers.runtime.currentTime}\n` +
          `- Channel: ${layers.runtime.channel}\n` +
          `- Session: ${layers.runtime.sessionId}\n` +
          `- Language: ${layers.runtime.language}`,
      );
    }

    // Layer 8: Channel-specific
    if (layers.channel) {
      dynamicParts.push("## Channel Instructions\n" + layers.channel);
    }

    const prompt = [...staticParts, ...dynamicParts].join("\n\n");

    this.log.debug(
      `Built system prompt: ${prompt.length} chars (${staticParts.length} static sections, ${dynamicParts.length} dynamic sections)`,
    );

    return prompt;
  }

  /**
   * Build a minimal system prompt (for testing or simple use cases).
   */
  buildMinimal(identity: string, tools: string): string {
    return this.build({
      identity,
      tools,
      runtime: {
        currentTime: new Date().toISOString(),
        channel: "cli",
        sessionId: "default",
        language: "en",
      },
    });
  }
}
