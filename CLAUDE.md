# CLAUDE.md — Agent Harness Engineering

## Project Overview

This is a **production-grade AI Agent Harness Engineering Platform** written in TypeScript. It implements best practices for Agent engineering -- including Agent Loop, Context Engineering, Skill design, self-evolution, security, concurrency, and observability -- as runnable code.

Primary language: **Chinese (zh)**. Code and comments are in English; user-facing content may be Chinese.

## Tech Stack

| Dimension | Choice |
|---|---|
| Language | TypeScript (Node.js 20+, ESM modules) |
| LLM Provider | Anthropic SDK (`@anthropic-ai/sdk`) |
| Storage | JSONL append-only logs + SQLite (`better-sqlite3`) |
| Scheduling | Croner for cron expressions |
| Testing | Vitest |
| Build | tsx (dev) + tsup (prod bundle) |
| Linting | Biome |

## Project Structure

```
agent-harness-engineering/
├── src/                        # Backend TypeScript source (29 modules)
│   ├── core/                   # Agent Loop, Tool Registry, Session, Types, Constants, Anthropic Client
│   ├── context/                # System Prompt Builder, Compaction, Context Layers, Bootstrap, Cache
│   ├── intelligence/           # Dual-layer Memory, Skill System, Workspace Manager
│   ├── channels/               # Channel abstraction, CLI REPL, WebSocket Gateway
│   ├── delivery/               # Delivery Queue with retry, Resilience (3-tier retry onion)
│   ├── concurrency/            # Named Lane queues, Heartbeat + Cron scheduler
│   ├── collaboration/          # Subagent isolation, Team mailbox, Protocols, Autonomous task board
│   ├── evolution/              # Self-Review, Skill Generator, Memory Scanner, Nudge engine
│   ├── evaluation/             # L1/L2/L3 Graders, Pass@k metrics, Online Sampler
│   ├── security/               # Permissions engine, Injection defense, Hook system, Sandbox
│   ├── observability/          # Event bus, Structured logger, Tracing
│   └── entrypoints/            # CLI entry point (src/entrypoints/cli.ts)
├── tests/unit/                 # 15 test files, 307 test cases (Vitest)
├── docs/principles/            # Knowledge base documents (5 deep-dive engineering guides)
├── workspace/                  # Agent workspace template (SOUL.md, IDENTITY.md, etc.)
├── Makefile                    # Convenience targets (see Commands below)
├── tsconfig.json               # TypeScript config (ES2023, bundler resolution, strict)
├── vitest.config.ts            # Vitest config: tests/**/*.test.ts, node env, globals
└── .env.example                # Environment variables template
```

## Commands

```bash
npm install          # Install dependencies
npm run dev          # Start CLI Agent REPL (tsx src/entrypoints/cli.ts)
npm run build        # Production build (tsup, ESM + .d.ts)
npm test             # Run all tests (vitest run)
npm run test:watch   # Watch mode
npm run typecheck    # Type check (tsc --noEmit)
npm run eval         # Run evaluation entry point
npm run lint         # Biome check src/ tests/
npm run format       # Biome format --write src/ tests/
```

Or via `make`:
```bash
make install dev build test typecheck eval lint format clean
```

## Architecture

The architecture follows a layered pipeline design:

```
+----------------------------------------------------------+
|                   Channels Layer                          |
|              CLI REPL / WebSocket Gateway                 |
+----------------------------------------------------------+
|                   Core Layer                              |
|     Agent Loop / Tool Registry / Session / Types          |
+------+------+------+------+------+------+------+---------+
| Ctx  | Intel| Deliv| Concur| Collab| Evol | Eval | Security|
+------+------+------+------+------+------+------+---------+
|                   Observability Layer                     |
|             Tracing / Event Bus / Logger                  |
+----------------------------------------------------------+
```

### Core Layer (`src/core/`)

- **Agent Loop** (`agent-loop.ts`): The fundamental `while stop_reason === "tool_use"` loop. Model handles reasoning; the loop handles state, boundaries, and persistence. All errors are caught and fed back to the model.
- **Tool Registry** (`tool-registry.ts`): ACI Gen 2 (goal-oriented) tool registration and dispatch. 5 built-in tools: `bash`, `read_file`, `write_file`, `edit_file`, `list_directory`. Tools declare when NOT to use them; errors include correction suggestions.
- **Session** (`session.ts`): JSONL-based append-on-write session persistence with metadata tracking. Sessions are immutable logs; compaction creates new sessions with summaries.
- **Types** (`types.ts`): Core type definitions -- Message (user/assistant roles with text/tool_use/tool_result content), Tool, Session, AgentConfig, LLMClient interface, Event types.
- **Constants** (`constants.ts`): Centralized tuning knobs -- compaction thresholds, bootstrap file limits, delivery backoff config, injection patterns, session file extensions.
- **Anthropic Client** (`anthropic-client.ts`): Thin wrapper around `@anthropic-ai/sdk`. Supports compatible providers via `ANTHROPIC_BASE_URL`. Includes `MockLLMClient` for testing.

### Context Engineering (`src/context/`)

- **Builder** (`builder.ts`): Assembles system prompt from 8 layers (Identity, Soul, Tools, Skills, Memory, Bootstrap, Runtime, Channel). Static layers (1-3) are cacheable; dynamic layers (4-8) are session-specific. Uses a `CACHE_BOUNDARY` marker for prefix caching.
- **Compaction** (`compaction.ts`): Three-layer strategy -- Micro (truncate long tool results every turn), Auto (LLM summarization at 85% context usage), Manual (user-triggered).
- **Layers** (`layers.ts`): Five-layer context model -- Resident (identity/rules), Skills (on-demand), Runtime (per-turn info), Memories (recalled), System (never in context, handled by hooks/code).
- **Bootstrap** (`bootstrap.ts`): Loads workspace brain files (SOUL.md, IDENTITY.md, TOOLS.md, etc.) with per-file (20KB) and total (150KB) caps.
- **Cache** (`cache.ts`): Splits system prompt into cache-optimized blocks at the boundary marker for LLM provider prefix caching.

### Intelligence Layer (`src/intelligence/`)

- **Memory** (`memory.ts`): Dual-layer memory -- Evergreen (MEMORY.md, factual knowledge loaded at bootstrap) and Ephemeral (daily JSONL logs, searchable via TF-IDF + hash projection). Hybrid retrieval with MMR re-ranking for diversity. Temporal decay with 30-day half-life.
- **Skills** (`skills.ts`): Skill = YAML frontmatter + Markdown body. Two-layer loading: metadata (name + description) in system prompt always; full body loaded on demand. Includes scanning, parsing, and prompt section generation.
- **Workspace** (`workspace.ts`): Manages the agent's "disk-based brain" -- file operations, directory structure, skill management.

### Channels Layer (`src/channels/`)

- **Base** (`base.ts`): Unified `Channel` interface (InboundMessage, OutboundMessage, start/stop/send/onMessage).
- **CLI** (`cli.ts`): stdin/stdout terminal channel.
- **Gateway** (`gateway.ts`): WebSocket server with 5-tier routing (peer > guild > account > channel > default) and configurable DM scope.

### Delivery Layer (`src/delivery/`)

- **Queue** (`queue.ts`): Write-ahead delivery queue with atomic writes (tmp + rename). Backoff schedule: 5s, 25s, 125s, 625s with +/-20% jitter. After 5 retries, moves to `failed/`.
- **Resilience** (`resilience.ts`): Three-tier retry onion -- Auth profile rotation (Layer 1), Context overflow compaction (Layer 2), Standard tool-use loop retry (Layer 3). Total cap: 160 retries.

### Concurrency (`src/concurrency/`)

- **Lanes** (`lanes.ts`): Named lane serialization with FIFO ordering and generation tracking. Stale tasks from old generations are silently dropped. Non-blocking Promise-based enqueue.
- **Heartbeat** (`heartbeat.ts`): Periodic agent wake-up with 4 precondition checks (lock, main lane empty, nothing to do, dedup). Cron scheduler with 3 schedule types (at/every/cron), auto-disable after 5 consecutive errors.

### Collaboration (`src/collaboration/`)

- **Subagent** (`subagent.ts`): Spawns isolated AgentLoop instances with fresh messages[], summary-only return, configurable timeout (default 2 min) and max turns.
- **Team** (`team.ts`): JSONL mailbox system for inter-agent communication. Message types: message, broadcast, shutdown_request/response, plan_approval_response.
- **Protocols** (`protocols.ts`): Shutdown handshake (30s timeout), Plan approval FSM (submit/approve/reject with max 3 revisions), Task handoff (context summary + acknowledgment).
- **Autonomous** (`autonomous.ts`): Shared task board (JSONL) with atomic claim, priority ordering, heartbeat progress tracking, and timeout re-claim.

### Self-Evolution (`src/evolution/`)

- **Self-Review** (`self-review.ts`): Post-session background analysis of tool error rates, slow calls, loop patterns, and learning signals. Outputs structured review reports to `.reviews/`.
- **Skill Generator** (`skill-generator.ts`): Auto-generates Skill drafts from repeated tool sequences, review findings, and user corrections. Drafts saved to `.skill-drafts/` for human approval.
- **Memory Scan** (`memory-scan.ts`): Pre-write security scan for injection, secrets (API keys/tokens), contradictions with existing memory, and off-topic content. Auto-rollback on critical findings.
- **Nudge** (`nudge.ts`): Reflection mechanism delivering contextual reminders (tool tips, context warnings, error patterns, review findings). Rate-limited to 3 per turn, with temporal decay.

### Evaluation (`src/evaluation/`)

- **Graders** (`graders.ts`): L1 (deterministic: exact match, regex, JSON schema), L2 (heuristic: rubric keyword/section/length checks), L3 (LLM-as-Judge: semantic quality). Cascade execution.
- **Metrics** (`metrics.ts`): Pass@k, Pass^k, MRR, Wilson score confidence intervals. Per-task and aggregate computation.
- **Sampler** (`sampler.ts`): Online evaluation with stratified sampling (coverage across task types), adaptive sampling (boosts when performance drops), trigger-based (always sample on errors), budget-aware.

### Security (`src/security/`)

- **Permissions** (`permissions.ts`): Allow/Deny/Ask three-tier engine with glob pattern matching. Secure by default (no rule = deny). Scopes: tool, file, net, env, session, system.
- **Injection Defense** (`injection.ts`): Three layers -- regex pattern matching (known attacks), structural analysis (role confusion, delimiter injection), entropy analysis (base64, zero-width, homoglyphs).
- **Hooks** (`hooks.ts`): 6 lifecycle hook points (before/after tool_call, before/after message, before_compact, on_error). Deterministic, fail-secure, ordered by priority.
- **Sandbox** (`sandbox.ts`): 4 isolation layers -- filesystem (workspace boundary, blocked sensitive paths), network (private IP block, allowlist/blocklist), environment (env var filtering), resource limits.

### Observability (`src/observability/`)

- **Events** (`events.ts`): Pub/sub EventBus. Agent loop emits once; tracing, evaluation subscribe independently.
- **Logger** (`logger.ts`): Simple structured logging (debug/info/warn/error) with component labels.
- **Tracing** (`tracing.ts`): Full execution trace recording -- messages, tool calls/results, token usage, latency. Saved to `.traces/` as JSON. Semantic keyword search support.

## Core Design Principles

1. **Harness > Model** -- Stability from peripheral engineering, not model capability
2. **Context 5-layer separation** -- Resident / On-demand / Runtime / Memory / System
3. **Deterministic logic stays out of context** -- Use hooks and code, not prompts
4. **Skills = Knowledge injection** -- YAML frontmatter + Markdown, loaded on demand
5. **Three-layer compaction** -- Micro (per-turn) / Auto (threshold) / Manual (user)
6. **ACI tool design** -- Goal-oriented with structured errors and suggestions
7. **Dual-path self-evolution** -- Skill generation + RL training data collection
8. **Pre-write security scanning** -- Memory/skills scanned before write, auto-rollback
9. **Event stream architecture** -- Publish once, consume many
10. **First failure = First test case**

## Key Conventions

- **Module system**: ESM (`"type": "module"` in package.json). Use `.js` extensions in imports (e.g., `import { X } from "./foo.js"`).
- **File storage**: All persistent data uses JSONL (append-on-write, crash-safe). Atomic writes use tmp + rename pattern.
- **Session IDs**: Format `s-{timestamp}-{random}`, e.g. `s-20260503065054-74t2c7`
- **Agent name**: Default is "Luna"; configurable via `AGENT_NAME` env var.
- **Default model**: `claude-sonnet-4-20250514`, configurable via `MODEL_ID`.
- **Workspace structure**: `workspace/{SOUL.md, IDENTITY.md, TOOLS.md, MEMORY.md, AGENTS.md, HEARTBEAT.md, BOOTSTRAP.md, skills/, .sessions/, .traces/, memory/}`
- **Test environment**: Node, globals enabled (`describe`/`it`/`expect` global), test files at `tests/unit/*.test.ts`
- **Linting**: Biome for both linting and formatting. Run `npm run lint` and `npm run format`.

## Environment Variables

See `.env.example` for the full list:

| Variable | Default | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | (required) | Anthropic API key |
| `MODEL_ID` | `claude-sonnet-4-20250514` | LLM model ID |
| `AGENT_NAME` | `Luna` | Agent display name |
| `AGENT_LANGUAGE` | `zh` | Primary language |
| `WORKSPACE_DIR` | `./workspace` | Agent workspace path |
| `GATEWAY_PORT` | `8787` | WebSocket gateway port |
| `GATEWAY_HOST` | `127.0.0.1` | WebSocket gateway host |
| `MAX_CONTEXT_TOKENS` | `100000` | Context window limit |
| `DELIVERY_MAX_RETRIES` | `5` | Max delivery retry attempts |
| `HEARTBEAT_INTERVAL_MS` | `60000` | Heartbeat interval in ms |

## Knowledge Base

The `docs/principles/` directory contains 5 deep-dive engineering guides derived from advanced technical articles:

| File | Source | Content |
|---|---|---|
| `harness-engineering.md` | Harness Engineering Practice | Harness > Model, Agent Loop, control patterns |
| `context-engineering.md` | Claude Code Architecture | 5-layer context, 3-layer compaction, Prompt Caching |
| `skill-design-patterns.md` | Skill Patterns & Best Practices | 5 core patterns + anti-patterns |
| `self-improving-agents.md` | Hermes Self-Evolution | Dual-path evolution, Self-Review, Nudge |
| `security-engineering.md` | Agent Security Engineering | Multi-layer defense, permission engine, sandbox |

## Testing

15 test files, 307 test cases, all covering:

```
src/core/          -> core-types, tool-registry, session, agent-loop
src/context/       -> context (builder, compaction, layers, cache, bootstrap)
src/intelligence/  -> intelligence (memory, skills, workspace)
src/channels/      -> channels-delivery
src/concurrency/   -> lanes, heartbeat
src/collaboration/ -> subagent, team, collaboration-protocols
src/evolution/     -> evolution (self-review, skill-generator, memory-scan, nudge)
src/evaluation/    -> evaluation (graders, metrics, sampler)
src/security/      -> security (permissions, injection, hooks, sandbox)
```

Tests follow the Arrange/Act/Assert pattern with descriptive `describe`/`it` blocks. Use the existing test files as templates for new tests. Tests import from `../../src/<module>` and use `vitest` globals.
