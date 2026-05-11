// Context Layer Management
// Five-layer context architecture (from knowledge base)

import type { AgentConfig, Message } from "../core/types.js";

export interface ContextLayers {
	/** Layer 1: Static identity and rules */
	resident: string;
	/** Layer 2: Skill descriptors (names + descriptions only) */
	skillDescriptors: string;
	/** Layer 3: Per-turn runtime info */
	runtime: string;
	/** Layer 4: Recalled memories */
	memories: string;
	/** Layer 5: System-level (never in context, handled by hooks/code) */
	system: never; // This layer is intentionally excluded from context
}

export class ContextLayerManager {
	/**
	 * Assemble the context layers into a unified system prompt.
	 * Layer 5 is intentionally excluded - it's handled by hooks and code.
	 */
	assemble(
		config: AgentConfig,
		residentFiles: Map<string, string>,
		skillSummary: string,
		memories: string,
	): string {
		const parts: string[] = [];

		// Layer 1: Resident
		const identity = residentFiles.get("IDENTITY.md") || "";
		const soul = residentFiles.get("SOUL.md") || "";
		if (identity) parts.push(`## Identity\n${identity}`);
		if (soul) parts.push(`## Communication Style\n${soul}`);

		// Layer 2: Skills (on-demand)
		if (skillSummary) {
			parts.push(`## Skills\n${skillSummary}`);
		}

		// Layer 3: Runtime
		parts.push(
			`## Runtime\n- Time: ${new Date().toISOString()}\n- Channel: ${config.channel}\n- Language: ${config.language}`,
		);

		// Layer 4: Memories
		if (memories) {
			parts.push(`## Memories\n${memories}`);
		}

		return parts.join("\n\n");
	}

	/**
	 * Calculate context usage ratio for a set of messages.
	 */
	estimateUsage(
		messages: Message[],
		maxTokens: number,
	): { estimatedTokens: number; ratio: number } {
		const text = messages
			.map((m) => {
				if (typeof m.content === "string") return m.content;
				return m.content
					.map((c) => (c.type === "text" ? c.text : ""))
					.join(" ");
			})
			.join(" ");
		const estimatedTokens = Math.ceil(text.length / 4);
		return { estimatedTokens, ratio: estimatedTokens / maxTokens };
	}
}
