---
name: agent-builder
description: Design and build AI agents for any domain. Use when creating, designing, scaffolding, or explaining agent systems. Covers agent loop, tools, memory, skills, and harness design.
type: workflow
---

# Agent Builder Skill

## Core Principle
Model IS the agent. Code just runs the loop.
Agency comes from training. Harness comes from engineering.

## Agent Architecture

### 1. Agent Loop
```
while stop_reason == "tool_use":
    response = LLM(messages, tools)
    execute tools
    append results
```

### 2. Tool Design (ACI Principles)
- Goal-oriented, not API wrapping
- Clear boundaries: say when NOT to use
- Structured errors with correction suggestions
- Definition and implementation bound together

### 3. Context Layers
- **Resident**: Identity, rules, prohibitions
- **On-Demand**: Skills (metadata always, body on trigger)
- **Runtime**: Time, channel, session info
- **Memory**: Cross-session recall
- **System**: Hooks, code rules (never in context)

### 4. Memory
- Evergreen (MEMORY.md): Static facts, user preferences
- Ephemeral (daily JSONL): Searchable, temporal decay
- Hybrid retrieval: TF-IDF + semantic + MMR

## Steps to Build an Agent
1. Define identity and personality (SOUL.md, IDENTITY.md)
2. Configure tools (ACI design)
3. Set up memory (dual-layer)
4. Add skills (YAML frontmatter + Markdown)
5. Implement harness (compaction, resilience, security)
6. Add observability (tracing, events)
7. Create evaluation suite
