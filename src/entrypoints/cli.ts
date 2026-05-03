#!/usr/bin/env tsx
/**
 * CLI Entry Point
 *
 * Interactive REPL for the Agent Harness.
 * Usage: npm run dev
 */

import { readFileSync, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { join, resolve } from "node:path";
import { AgentLoop } from "../core/agent-loop.js";
import { AnthropicClient } from "../core/anthropic-client.js";
import { createDefaultRegistry } from "../core/tool-registry.js";
import { SessionStore } from "../core/session.js";
import { EventBus } from "../observability/events.js";
import { Tracing } from "../observability/tracing.js";
import { createLogger } from "../observability/logger.js";

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
    const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
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
// REPL
// ============================================================

async function main(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error(`${RED}Error: ANTHROPIC_API_KEY not set. Create a .env file.${RESET}`);
    process.exit(1);
  }

  const workspaceDir = process.env.WORKSPACE_DIR || "./workspace";
  const model = process.env.MODEL_ID || "claude-sonnet-4-20250514";

  const llm = new AnthropicClient(apiKey, process.env.ANTHROPIC_BASE_URL, model);
  const tools = createDefaultRegistry();
  const session = new SessionStore(workspaceDir);
  const events = new EventBus();
  const tracing = new Tracing(session.sessionId, workspaceDir);

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
      maxContextTokens: 100_000,
      language: "zh",
      channel: "cli" as const,
    },
    llm,
    tools,
    session,
    eventBus: events,
    tracing,
  });

  // Build system prompt
  const systemPrompt = buildSystemPrompt(workspaceDir);

  // Banner
  console.log(`
${CYAN}${BOLD}╔══════════════════════════════════════════════════╗
║       Agent Harness Engineering — CLI REPL       ║
╚══════════════════════════════════════════════════╝${RESET}
  Model: ${model}
  Session: ${session.sessionId}
  Workspace: ${workspaceDir}
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
      const cmd = input.toLowerCase();
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
            ? m.content.map((c) => (c.type === "text" ? c.text : `[${c.type}]`)).join(" ")
            : m.content;
          console.log(`  ${m.role}: ${content.slice(0, 100)}...`);
        }
        rl.prompt();
        return;
      }
      if (cmd.startsWith("/system")) {
        console.log(`${DIM}${systemPrompt.slice(0, 500)}...${RESET}`);
        rl.prompt();
        return;
      }
    }

    // Send message
    try {
      process.stdout.write(`${GREEN}${BOLD}Assistant:${RESET} `);
      const response = await loop.sendMessage(input, systemPrompt);
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
  /help      Show this help
  /quit      Exit the REPL
  /reset     Reset conversation history
  /messages  Show current message history
  /system    Show system prompt preview

${BOLD}Built-in Tools:${RESET}
  bash          Execute shell commands
  read_file     Read file contents
  write_file    Create or overwrite files
  edit_file     Make precise edits to files
  list_directory  List files in a directory
`);
}

function buildSystemPrompt(workspaceDir: string): string {
  const parts = [
    "You are a helpful AI assistant with access to tools.",
    "",
    "## Workspace",
    `Your working directory is: ${resolve(workspaceDir)}`,
    "All file operations are relative to this directory.",
    "",
    "## Guidelines",
    "- Use tools to accomplish tasks. Don't just describe what you would do.",
    "- Read files before editing them.",
    "- Prefer edit_file for small changes, write_file for new files.",
    "- Be concise and direct in your responses.",
  ];

  // Load workspace files if they exist
  const workspaceFiles = ["SOUL.md", "IDENTITY.md", "TOOLS.md", "MEMORY.md"];
  for (const file of workspaceFiles) {
    const path = join(workspaceDir, file);
    if (existsSync(path)) {
      parts.push("");
      parts.push(`## ${file.replace(".md", "").toUpperCase()}`);
      parts.push(readFileSync(path, "utf-8"));
    }
  }

  return parts.join("\n");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
