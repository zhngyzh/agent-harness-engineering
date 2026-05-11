#!/usr/bin/env tsx
/**
 * CLI Entry Point
 *
 * Interactive REPL for the Agent Harness.
 * Usage: npm run dev
 *
 * Full context engineering pipeline:
 *   BootstrapLoader → SkillsManager → MemoryStore → SystemPromptBuilder → PromptCache
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { BootstrapLoader } from "../context/bootstrap.js";
import { SystemPromptBuilder } from "../context/builder.js";
import { cacheRatio, splitCacheBlocks } from "../context/cache.js";
import { ContextCompactor } from "../context/compaction.js";
import { AgentLoop } from "../core/agent-loop.js";
import { AnthropicClient } from "../core/anthropic-client.js";
import { SessionStore } from "../core/session.js";
import { createDefaultRegistry } from "../core/tool-registry.js";
import type { Message } from "../core/types.js";
import { MemoryStore } from "../intelligence/memory.js";
import { SkillsManager } from "../intelligence/skills.js";
import { EventBus } from "../observability/events.js";
import { createLogger } from "../observability/logger.js";
import { Tracing } from "../observability/tracing.js";

const log = createLogger("cli");

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
		const value = trimmed
			.slice(eqIdx + 1)
			.trim()
			.replace(/^["']|["']$/g, "");
		if (!process.env[key]) {
			process.env[key] = value;
		}
	}
}

loadEnv();

// ============================================================
// ANSI Colors
// ============================================================

const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

// ============================================================
// Context Engine — wires all context engineering modules
// ============================================================

class ContextEngine {
	readonly bootstrap: BootstrapLoader;
	readonly skills: SkillsManager;
	readonly memory: MemoryStore;
	readonly builder: SystemPromptBuilder;
	readonly compactor: ContextCompactor;

	private _systemPrompt = "";
	private _cacheRatio = 0;

	constructor(
		workspaceDir: string,
		llm: AnthropicClient,
		model: string,
		maxContextTokens: number,
	) {
		this.bootstrap = new BootstrapLoader(workspaceDir);
		this.skills = new SkillsManager([join(workspaceDir, "skills")]);
		this.memory = new MemoryStore(workspaceDir);
		this.builder = new SystemPromptBuilder();
		this.compactor = new ContextCompactor(llm, model, maxContextTokens);
	}

	/** Initialize all context sources */
	init(): void {
		this.skills.load();
		this.memory.init();
		this.rebuild();
	}

	/** Rebuild the system prompt from all layers */
	rebuild(): void {
		const bootstrapResult = this.bootstrap.load();
		const skillSummaries = this.skills.getSummaries();

		this._systemPrompt = this.builder.build({
			identity: this.loadIdentity(),
			soul: this.loadSoul(),
			tools: this.buildToolsLayer(),
			skills: skillSummaries.length > 0 ? skillSummaries : undefined,
			bootstrap: bootstrapResult,
			runtime: {
				currentTime: new Date().toISOString(),
				channel: "cli",
				sessionId: "cli-session",
				language: process.env.AGENT_LANGUAGE || "zh",
			},
		});

		this._cacheRatio = cacheRatio(this._systemPrompt);
	}

	get systemPrompt(): string {
		return this._systemPrompt;
	}

	get cacheRatio(): number {
		return this._cacheRatio;
	}

	/** Get cache-optimized blocks for the current prompt */
	get cacheBlocks() {
		return splitCacheBlocks(this._systemPrompt);
	}

	/** Auto-recall relevant memories for a query */
	recall(query: string): string {
		return this.memory.autoRecall(query, 800);
	}

	/** Check if compaction is needed and compact if so */
	async maybeCompact(messages: { length: number }[]): Promise<boolean> {
		if (
			this.compactor.shouldCompact(messages as unknown as Message[], 100_000)
		) {
			log.info("Auto-compaction triggered");
			return true;
		}
		return false;
	}

	/** Get context stats for /status command */
	getStats() {
		const memStats = this.memory.getStats();
		return {
			promptChars: this._systemPrompt.length,
			cacheRatio: `${Math.round(this._cacheRatio * 100)}%`,
			skills: this.skills.list().length,
			memory: memStats,
			bootstrapFiles: this.bootstrap.load().files.length,
		};
	}

	// ============================================================
	// Private
	// ============================================================

	private loadIdentity(): string {
		// Identity is loaded from bootstrap files; return empty since
		// BootstrapLoader already includes IDENTITY.md in the bootstrap layer.
		return "";
	}

	private loadSoul(): string {
		// Soul is loaded from bootstrap files; same as identity.
		return "";
	}

	private buildToolsLayer(): string {
		return (
			"Available tools: bash, read_file, write_file, edit_file, list_directory. " +
			"Use tools to accomplish tasks. Read files before editing them."
		);
	}
}

// ============================================================
// REPL
// ============================================================

async function main(): Promise<void> {
	const apiKey = process.env.ANTHROPIC_API_KEY;
	if (!apiKey) {
		console.error(
			`${RED}Error: ANTHROPIC_API_KEY not set. Create a .env file.${RESET}`,
		);
		process.exit(1);
	}

	const workspaceDir = resolve(process.env.WORKSPACE_DIR || "./workspace");
	const model = process.env.MODEL_ID || "claude-sonnet-4-20250514";
	const maxContextTokens = Number.parseInt(
		process.env.MAX_CONTEXT_TOKENS || "100000",
		10,
	);

	const llm = new AnthropicClient(
		apiKey,
		process.env.ANTHROPIC_BASE_URL,
		model,
	);
	const tools = createDefaultRegistry();
	const session = new SessionStore(workspaceDir);
	const events = new EventBus();
	const tracing = new Tracing(session.sessionId, workspaceDir);

	// Initialize the full context engine
	const ctxEngine = new ContextEngine(
		workspaceDir,
		llm,
		model,
		maxContextTokens,
	);
	ctxEngine.init();

	// Log events to console
	events.on((event) => {
		if (event.type === "tool_start") {
			console.log(`${DIM}  ⚙ ${event.data.tool}${RESET}`);
		} else if (event.type === "tool_error") {
			console.log(`${RED}  ✗ ${event.data.tool}: ${event.data.error}${RESET}`);
		}
	});

	const loop = new AgentLoop({
		config: {
			name: process.env.AGENT_NAME || "Luna",
			model,
			workspaceDir,
			maxTokens: 8096,
			maxTurns: 50,
			maxContextTokens,
			language: process.env.AGENT_LANGUAGE || "zh",
			channel: "cli" as const,
		},
		llm,
		tools,
		session,
		eventBus: events,
		tracing,
	});

	// Banner
	const stats = ctxEngine.getStats();
	console.log(`
${CYAN}${BOLD}╔══════════════════════════════════════════════════╗
║       Agent Harness Engineering — CLI REPL       ║
╚══════════════════════════════════════════════════╝${RESET}
  Model: ${model}
  Session: ${session.sessionId}
  Workspace: ${workspaceDir}
  Skills: ${stats.skills} | Memory: ${stats.memory.evergreen}E/${stats.memory.daily}D
  Prompt: ${stats.promptChars} chars | Cache: ${stats.cacheRatio}
  ${DIM}Type /help for commands, /quit to exit.${RESET}
`);

	const rl = createInterface({
		input: process.stdin,
		output: process.stdout,
		prompt: `${CYAN}${BOLD}You > ${RESET}`,
	});

	rl.prompt();

	rl.on("line", async (line) => {
		const input = line.trim();

		if (!input) {
			rl.prompt();
			return;
		}

		// Handle commands
		if (input.startsWith("/")) {
			const cmd = input.toLowerCase().split(/\s+/)[0];
			const args = input.slice(cmd.length).trim();

			if (cmd === "/quit" || cmd === "/exit") {
				console.log(`${DIM}Goodbye.${RESET}`);
				tracing.save();
				rl.close();
				return;
			}
			if (cmd === "/help") {
				printHelp();
				rl.prompt();
				return;
			}
			if (cmd === "/reset") {
				loop.reset();
				console.log(`${YELLOW}Session reset.${RESET}`);
				rl.prompt();
				return;
			}
			if (cmd === "/messages") {
				const msgs = loop.getMessages();
				console.log(`${DIM}Messages: ${msgs.length}${RESET}`);
				for (const m of msgs) {
					const content = Array.isArray(m.content)
						? m.content
								.map((c) => (c.type === "text" ? c.text : `[${c.type}]`))
								.join(" ")
						: m.content;
					console.log(`  ${m.role}: ${content.slice(0, 100)}...`);
				}
				rl.prompt();
				return;
			}
			if (cmd === "/system") {
				const prompt = ctxEngine.systemPrompt;
				if (args === "full") {
					console.log(`${DIM}${prompt}${RESET}`);
				} else {
					console.log(
						`${DIM}${prompt.slice(0, 500)}... (${prompt.length} chars total)${RESET}`,
					);
				}
				rl.prompt();
				return;
			}
			if (cmd === "/status") {
				const s = ctxEngine.getStats();
				console.log(`${DIM}System Prompt: ${s.promptChars} chars`);
				console.log(`Cache Ratio: ${s.cacheRatio}`);
				console.log(`Skills Loaded: ${s.skills}`);
				console.log(
					`Memory: ${s.memory.evergreen} evergreen, ${s.memory.daily} daily`,
				);
				console.log(`Bootstrap Files: ${s.bootstrapFiles}${RESET}`);
				rl.prompt();
				return;
			}
			if (cmd === "/memory") {
				if (args) {
					const results = ctxEngine.memory.search(args, 5);
					if (results.length === 0) {
						console.log(`${DIM}No memories found for "${args}"${RESET}`);
					} else {
						console.log(`${DIM}Memory search results for "${args}":${RESET}`);
						for (const r of results) {
							console.log(
								`  [${r.source}] (${r.score.toFixed(2)}) ${r.fact.content.slice(0, 80)}`,
							);
						}
					}
				} else {
					const memStats = ctxEngine.memory.getStats();
					console.log(
						`${DIM}Evergreen: ${memStats.evergreen} facts | Daily: ${memStats.daily} facts`,
					);
					console.log(`Usage: /memory <query> to search${RESET}`);
				}
				rl.prompt();
				return;
			}
			if (cmd === "/skills") {
				const skillList = ctxEngine.skills.list();
				if (skillList.length === 0) {
					console.log(
						`${DIM}No skills loaded. Place SKILL.md files in workspace/skills/.${RESET}`,
					);
				} else {
					console.log(`${DIM}Loaded skills:${RESET}`);
					for (const s of skillList) {
						console.log(
							`  - ${s.frontmatter.name}: ${s.frontmatter.description.slice(0, 60)}`,
						);
					}
				}
				rl.prompt();
				return;
			}
			if (cmd === "/compact") {
				const msgs = [...loop.getMessages()];
				if (msgs.length <= 4) {
					console.log(
						`${YELLOW}Too few messages to compact (${msgs.length})${RESET}`,
					);
				} else {
					const result = await ctxEngine.compactor.compact(msgs, "manual");
					if (result.compacted) {
						loop.reset();
						console.log(
							`${YELLOW}Compacted: ${result.record?.messagesBefore} → ${result.record?.messagesAfter} messages${RESET}`,
						);
					} else {
						console.log(`${DIM}Compaction not needed.${RESET}`);
					}
				}
				rl.prompt();
				return;
			}
			if (cmd === "/reload") {
				ctxEngine.skills.load();
				ctxEngine.rebuild();
				const s = ctxEngine.getStats();
				console.log(
					`${YELLOW}Context reloaded. Skills: ${s.skills}, Prompt: ${s.promptChars} chars${RESET}`,
				);
				rl.prompt();
				return;
			}

			console.log(
				`${RED}Unknown command: ${cmd}. Type /help for available commands.${RESET}`,
			);
			rl.prompt();
			return;
		}

		// Inject relevant memories into the user message
		const recalled = ctxEngine.recall(input);
		const enrichedInput = recalled
			? `${input}\n\n[Relevant memories:\n${recalled}]`
			: input;

		// Send message
		try {
			process.stdout.write(`${GREEN}${BOLD}Assistant:${RESET} `);
			const response = await loop.sendMessage(
				enrichedInput,
				ctxEngine.systemPrompt,
			);
			console.log(response);
		} catch (err) {
			console.error(`${RED}Error: ${(err as Error).message}${RESET}`);
			log.error("Agent loop error", { error: (err as Error).message });
		}

		rl.prompt();
	});

	rl.on("close", () => {
		tracing.save();
		process.exit(0);
	});
}

function printHelp(): void {
	console.log(`
${BOLD}Commands:${RESET}
  /help       Show this help
  /quit       Exit the REPL
  /reset      Reset conversation history
  /messages   Show current message history
  /system     Show system prompt preview (use /system full for complete)
  /status     Show context engine stats
  /memory     Show memory stats (use /memory <query> to search)
  /skills     List loaded skills
  /compact    Manually compact conversation context
  /reload     Reload skills and rebuild system prompt

${BOLD}Built-in Tools:${RESET}
  bash            Execute shell commands
  read_file       Read file contents
  write_file      Create or overwrite files
  edit_file       Make precise edits to files
  list_directory  List files in a directory

${BOLD}Context Engineering:${RESET}
  The CLI uses the full context engineering pipeline:
  BootstrapLoader → SkillsManager → MemoryStore → SystemPromptBuilder → PromptCache
  Memories are auto-recalled and injected into each user message.
`);
}

main().catch((err) => {
	console.error("Fatal error:", err);
	process.exit(1);
});
