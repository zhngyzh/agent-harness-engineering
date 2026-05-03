# Security Engineering

> 来源：你不知道的 Agent + 深度解析 Claude Code 在 Prompt / Context / Harness 的设计与实践
> 核心结论：安全是多层防御，单层突破不导致整体失效。

## 1. 安全架构总览

```
┌─────────────────────────────────────────────┐
│              Agent System                    │
├─────────────┬───────────────┬───────────────┤
│  Permission │   Injection   │    Sandbox    │
│   Engine    │   Defense     │   Isolation   │
├─────────────┼───────────────┼───────────────┤
│  Allow/     │  L1: Pattern  │  Filesystem   │
│  Deny/Ask   │  L2: Struct   │  Network      │
│  + Glob     │  L3: Entropy  │  Env Vars     │
├─────────────┴───────────────┴───────────────┤
│              Hook System                     │
│  before_tool / after_tool / before_msg ...  │
├─────────────────────────────────────────────┤
│           Audit Logging (JSONL)              │
└─────────────────────────────────────────────┘
```

## 2. 权限引擎

**三态模型**：Allow / Deny / Ask

**设计原则**：
- 安全默认：无规则 = 拒绝
- 显式允许：必须明确配置才能放行
- 规则有序：第一个匹配的规则生效
- Ask 可升级：Ask 可配置为异步等待人工审批

**权限域**：
- `tool:*` 或 `tool:bash` — 工具执行
- `file:read:*`, `file:write:/tmp/*` — 文件操作（glob 模式）
- `net:*` — 网络访问
- `env:read:*`, `env:write:*` — 环境变量
- `session:*`, `system:*` — 会话和系统操作

**Glob 匹配**：支持 `*`（单层）、`**`（跨路径）、`?`（单字符）

## 3. Prompt 注入防御（三层）

### Layer 1：模式匹配

已知攻击签名：
- "Ignore previous instructions"
- "System prompt override"
- "You are now..." 人格劫持
- 分隔符注入（`<system>`, `[SYSTEM]`）

### Layer 2：结构分析

- 角色混淆标记检测（`assistant:`, `system:`, `You are...`）
- 分隔符注入检测（`<system>`, `</system>`, `[INST]`）
- 指令类内容检测（用户消息中的指令模式）

### Layer 3：熵分析

- Base64 块检测（>30% 输入为 base64 → 可疑）
- 零宽字符检测（隐藏信息载体）
- 同形异义字符检测（西里尔字母伪装）
- Unicode 转义序列检测

**风险计算**：取所有发现中的最高风险等级；多个 medium+ 发现自动升级到 high。

**清理策略**：
- 移除零宽字符
- 替换注入标记为 `[BLOCKED]`

## 4. Hook 系统

**6 个生命周期钩子**：

| 钩子点 | 时机 | 用途 |
|--------|------|------|
| `before_tool_call` | 工具调用前 | 验证/修改工具输入 |
| `after_tool_call` | 工具调用后 | 验证/修改工具输出 |
| `before_message` | 消息发送前 | 验证/修改出站消息 |
| `after_message` | 消息接收后 | 处理入站消息 |
| `before_compact` | 压缩前 | 决定保留什么 |
| `on_error` | 错误时 | 确定性错误处理 |

**设计原则**：
- 确定性——不调用 LLM
- 可阻塞、可修改、可通过
- 顺序执行，优先级排序
- 错误时默认阻塞（fail-secure）
- 所有执行记录审计日志

## 5. 沙箱隔离

### 文件系统沙箱

- 工作区边界：Agent 只能访问工作区内的文件
- 敏感路径阻止：`/etc`, `/root`, `~/.ssh`, `~/.gnupg`, `~/.aws`
- 只读模式：可选禁止所有写操作
- 文件大小限制：默认 10MB

### 网络沙箱

- 私有 IP 范围阻止：`10.x`, `172.16-31.x`, `192.168.x`, `127.x`
- 主机白名单/黑名单
- 可选完全网络隔离

### 环境沙箱

- 敏感环境变量阻止：`API_KEY`, `TOKEN`, `SECRET_KEY`, `PASSWORD` 等
- 白名单模式：只允许指定的环境变量
- 过滤后传递给子进程

### 资源限制

- 最大文件大小：10MB（可配置）
- 最大输出大小：1MB（可配置）
- 最大执行时间：30s（可配置）

## 6. 审计日志

所有安全相关事件都记录为 JSONL：

```
.security/
├── injection-YYYY-MM-DD.jsonl
├── permissions-YYYY-MM-DD.jsonl
└── hooks-YYYY-MM-DD.jsonl
```

每条记录包含：时间戳、事件类型、决策/动作、原因、相关上下文。

## 7. Claude Code 安全设计

Claude Code 的安全机制：

- **Bubblewrap 沙箱**：Linux 上用 bubblewrap 隔离进程
- **路径验证**：所有文件操作验证路径在允许范围内
- **网络控制**：通过 `--dangerously-skip-permissions` 显式关闭（需用户确认）
- **工具隔离**：文件读写、编辑、搜索分离，Bash 工具在沙箱中执行
- **源-汇分离**：用户数据与系统指令分离，`<untrusted_content>` 包裹用户输入

## 8. 安全检查清单

- [ ] 权限引擎配置了默认拒绝规则
- [ ] 注入防御三层全部启用
- [ ] Hook 系统在关键生命周期点有检查
- [ ] 沙箱隔离了文件系统、网络、环境变量
- [ ] 所有安全事件记录审计日志
- [ ] 记忆/Skill 写入前扫描
- [ ] 资源限制已配置
- [ ] Ask 处理器有超时和默认拒绝