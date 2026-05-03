# MEMORY.md — Long-Term Memory

## User Preferences
- Prefers concise, direct answers
- Primary language: Chinese (zh)
- Timezone: Asia/Shanghai (UTC+8)
- Working on AI agent and harness engineering projects

## Project Context
- Building `agent-harness-engineering`: a production-grade TypeScript Agent Harness platform
- Integrating knowledge from claw0, learn-claude-code, and personal knowledge base
- Core principle: Harness > Model (stability from engineering, not just model capability)

## Key Design Principles (from knowledge base)
1. Harness > Model: Stability from peripheral engineering
2. Context layering: Resident / On-demand / Runtime / Memory / System
3. Deterministic logic stays out of context (hooks, code rules)
4. Skill = Knowledge injection via YAML frontmatter + Markdown
5. Three-layer compaction: micro / auto / manual
6. ACI design: Goal-oriented tools, not API wrappers
7. Self-evolution: Skill generation + RL training data
8. Security scanning: Pre-write scan for memory/skills, auto-rollback
9. Event stream: Publish once, consume many
10. First failure = First test case
