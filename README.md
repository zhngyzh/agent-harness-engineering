# Agent Harness Engineering

> 生产级 AI Agent Harness 工程平台 — TypeScript 实现

Agent Harness Engineering 是一个全栈 TypeScript 平台，将 Agent 原理、Harness 工程、Context 工程、Skill 设计、自进化和安全工程的最佳实践落地为可运行代码，配备 Next.js 控制面板。

## 架构总览

```
┌──────────────────────────────────────────────────────┐
│                  Next.js 控制面板                     │
│         Dashboard / Agents / Sessions / Skills       │
├──────────────────────────────────────────────────────┤
│                   Channels 通道层                     │
│              CLI REPL / WebSocket Gateway             │
├──────────────────────────────────────────────────────┤
│                   Core 核心层                         │
│     Agent Loop / Tool Registry / Session / Types     │
├──────────┬──────────┬──────────┬─────────────────────┤
│ Context  │Intel     │Delivery  │ Observability       │
│ 上下文工程│ 智能层    │ 投递层    │ 可观测性             │
├──────────┴──────────┴──────────┴─────────────────────┤
│  Concurrency │ Collaboration │ Evolution │ Security   │
│  并发层       │ 协作层         │ 自进化层   │ 安全层     │
└──────────────────────────────────────────────────────┘
```

## 技术栈

| 维度 | 选型 |
|------|------|
| 语言 | TypeScript (Node.js 20+) |
| 前端 | Next.js 15 + React 19 + Tailwind CSS 4 |
| API 客户端 | @anthropic-ai/sdk |
| 存储 | JSONL + SQLite (better-sqlite3) |
| 测试 | Vitest |
| 构建 | tsx + tsup |

## 项目结构

```
agent-harness-engineering/
├── src/
│   ├── core/              # 核心层：Agent Loop、工具注册、会话管理、类型系统
│   ├── context/           # 上下文工程：系统提示词组装、三层压缩、缓存分块
│   ├── intelligence/      # 智能层：双层记忆、Skill 发现/加载、工作区管理
│   ├── channels/          # 通道层：CLI REPL、WebSocket 网关
│   ├── delivery/          # 投递层：预写队列、三层重试洋葱、认证轮换
│   ├── concurrency/       # 并发层：命名车道、心跳 + Cron 调度
│   ├── collaboration/     # 协作层：子 Agent 隔离、团队邮箱、协议、自主任务
│   ├── evolution/         # 自进化层：后台审查、Skill 生成、记忆扫描、Nudge
│   ├── evaluation/        # 评测层：三级评分器、Pass@k 指标、在线采样
│   ├── observability/     # 可观测性：Trace、事件总线、结构化日志
│   ├── security/          # 安全层：权限引擎、注入防御、Hook 系统、沙箱隔离
│   └── entrypoints/       # 入口点：CLI、Eval
│
├── app/                   # Next.js 控制面板
│   ├── page.tsx           # 仪表盘首页
│   ├── agents/page.tsx    # Agent 状态管理
│   ├── sessions/page.tsx  # 会话历史
│   ├── skills/page.tsx    # Skill 管理
│   ├── eval/page.tsx      # 评测结果
│   └── components/        # 共享 UI 组件
│
├── docs/principles/       # 知识库文档（代码化工程原则）
│   ├── harness-engineering.md
│   ├── context-engineering.md
│   ├── skill-design-patterns.md
│   ├── self-improving-agents.md
│   └── security-engineering.md
│
├── tests/unit/            # 15 个测试文件，307 个测试用例
└── workspace/             # Agent 工作区模板
```

## 快速开始

```bash
# 安装依赖
npm install

# 运行测试
npm test

# 启动 CLI Agent REPL
npm run dev

# 启动 Next.js 控制面板
npm run web
# → http://localhost:3000

# 类型检查
npm run typecheck
```

## 核心设计原则

1. **Harness > 模型** — 稳定性由外围工程决定，不依赖模型能力
2. **上下文五层分离** — 常驻 / 按需 / 运行时 / 记忆 / 系统
3. **确定性逻辑不进上下文** — 能放 Hook/代码的就不放提示词
4. **Skill = 知识注入** — YAML frontmatter + Markdown，按需加载
5. **三层压缩** — Micro（每轮）/ Auto（阈值）/ Manual（手动）
6. **ACI 三代设计** — API 封装 → 面向 Agent 目标 → 动态发现
7. **自进化双路径** — Skill 生成 + RL 训练数据收集
8. **安全扫描前置** — 记忆/Skill 写入前扫描，自动回滚
9. **事件流架构** — 一次发布，多消费者
10. **先评测后优化** — 第一个失败 = 第一个测试用例

## 模块说明

### 核心层 (`src/core/`)
- **Agent Loop** — `while` 循环 + `stop_reason` 驱动的工具调用迭代
- **Tool Registry** — ACI 三代工具注册与调度，支持 goal-oriented 错误和建议
- **Session** — JSONL 持久化 + ContextGuard 上下文保护
- **Types** — Message、Tool、Config、Session 核心类型系统

### 上下文工程 (`src/context/`)
- **Builder** — 系统提示词 8 层动态组装
- **Compaction** — 三层压缩：Micro / Auto / Manual
- **Layers** — 五层上下文管理（常驻→按需→运行时→记忆→系统）
- **Cache** — 缓存分块 + KV Cache 优化

### 智能层 (`src/intelligence/`)
- **Memory** — 双层记忆：常青记忆（MEMORY.md）+ 临时记忆（JSONL + TF-IDF + MMR）
- **Skills** — Skill 发现、加载、安全扫描
- **Workspace** — 工作区管理（SOUL.md、IDENTITY.md、TOOLS.md 等）

### 安全层 (`src/security/`)
- **Permissions** — Allow/Deny/Ask 三态权限引擎，glob 模式匹配，安全默认
- **Injection** — 三层 Prompt 注入防御：模式匹配 → 结构分析 → 熵分析
- **Hooks** — 6 个生命周期钩点，确定性逻辑，fail-secure
- **Sandbox** — 文件系统/网络/环境变量/资源限制四层隔离

### 自进化 (`src/evolution/`)
- **Self-Review** — 后台审查 fork，分析工具错误率、慢调用、循环模式
- **Skill Generator** — 从重复工具序列和审查发现自动生成 Skill 草稿
- **Memory Scan** — 写入前扫描注入、秘密、矛盾、离群内容
- **Nudge** — 反思机制，生成优先级排序的改进建议

### 评测 (`src/evaluation/`)
- **Graders** — 三级级联评分：L1 确定性 → L2 启发式 → L3 LLM-as-Judge
- **Metrics** — Pass@k、Pass^k、MRR，Wilson score 置信区间
- **Sampler** — 分层/自适应/触发式在线评测采样

### 并发与协作 (`src/concurrency/`, `src/collaboration/`)
- **Lanes** — 命名车道 + generation 追踪
- **Heartbeat** — Cron 调度 + 心跳监控
- **Subagent** — 子 Agent 隔离运行
- **Team** — JSONL 邮箱实现 Agent 间通信
- **Protocols** — 关闭/审批/交接协议
- **Autonomous** — 原子任务认领 + 超时重声明

## 测试

```
15 个测试文件，307 个测试用例，全部通过 ✓

src/core/          → core-types.test.ts, tool-registry.test.ts, session.test.ts, agent-loop.test.ts
src/context/       → context.test.ts
src/intelligence/  → intelligence.test.ts
src/channels/      → channels-delivery.test.ts
src/concurrency/   → lanes.test.ts, heartbeat.test.ts
src/collaboration/ → subagent.test.ts, team.test.ts, collaboration-protocols.test.ts
src/evolution/     → evolution.test.ts
src/evaluation/    → evaluation.test.ts
src/security/      → security.test.ts
```

## 知识库

`docs/principles/` 包含从 6 篇深度技术文章中提炼的工程原则：

| 文档 | 来源 | 核心内容 |
|------|------|----------|
| [harness-engineering.md](docs/principles/harness-engineering.md) | Harness Engineering 实践 | Harness > 模型、Agent Loop、控制模式 |
| [context-engineering.md](docs/principles/context-engineering.md) | Claude Code 架构解析 | 五层上下文、三层压缩、Prompt Caching |
| [skill-design-patterns.md](docs/principles/skill-design-patterns.md) | Skill 模式与最佳实践 | 5 个核心模式 + 反模式 |
| [self-improving-agents.md](docs/principles/self-improving-agents.md) | Hermes 自进化 | 双路径进化、Self-Review、Nudge |
| [security-engineering.md](docs/principles/security-engineering.md) | Agent 安全工程 | 多层防御、权限引擎、沙箱隔离 |

## License

MIT
