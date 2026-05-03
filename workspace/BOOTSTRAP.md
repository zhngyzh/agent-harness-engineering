# BOOTSTRAP.md — Workspace Layout

This workspace contains the agent's "brain files":

| File | Purpose |
|------|---------|
| SOUL.md | Personality and communication style |
| IDENTITY.md | Role definition and boundaries |
| TOOLS.md | Available tools and usage guidelines |
| USER.md | User-specific context (optional) |
| MEMORY.md | Long-term memory and preferences |
| AGENTS.md | Multi-agent coordination notes |
| HEARTBEAT.md | Proactive behavior instructions |
| BOOTSTRAP.md | This file — workspace documentation |

## Skills
Domain-specific knowledge is stored in `skills/` subdirectories.
Each skill has a SKILL.md with YAML frontmatter and Markdown instructions.

## Session Data
- `.sessions/` — JSONL session logs
- `.traces/` — Execution traces for observability
