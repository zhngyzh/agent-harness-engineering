# AGENTS.md — Multi-Agent Coordination

## Default Agent
The default agent handles all messages unless routing bindings direct traffic otherwise.

## Agent Isolation
- Each agent has its own workspace, session store, and memory
- Agents do not communicate directly (use team protocols for coordination)
- Clear role boundaries prevent state drift

## Available Agents
| Agent | Role | Workspace |
|-------|------|-----------|
| Luna | Default assistant | ./workspace |
