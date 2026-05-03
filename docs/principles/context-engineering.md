# Context Engineering

> 来源：你不知道的 Agent + 深度解析 Claude Code 在 Prompt / Context / Harness 的设计与实践
> 核心结论：问题通常不是窗口不够长，而是信息密度不对。

## 1. Context Rot 现象

Transformer 的注意力复杂度是 O(n²)，上下文越长，关键信号越容易被噪声稀释。无关内容一旦占到上下文的大头，Agent 的决策质量就会明显下滑。

## 2. 上下文五层分离

每层只放自己该放的东西：

| 层级 | 内容 | 加载策略 |
|------|------|----------|
| **常驻层** | 身份定义、项目约定、绝对禁止项 | 每次会话必须成立，保持短、硬、可执行 |
| **按需加载** | Skills 和领域知识 | 描述符常驻，完整内容触发时再注入 |
| **运行时注入** | 当前时间、渠道 ID、用户偏好 | 每轮按需拼入 |
| **记忆层** | 跨会话经验（MEMORY.md） | 不直接进系统提示，需要时才读取 |
| **系统层** | Hooks 或代码规则 | 确定性逻辑绝不进上下文 |

## 3. Skills 按需加载

**核心思路**：系统提示只保留索引，完整知识按需加载。

```typescript
// 系统提示中只放描述符（~100 tokens）
const systemPrompt = `
可用 Skills：
- deploy: 部署到生产环境。Use when deploying to production.
- code-review: 代码审查。Use when reviewing code changes.
`;

// 完整内容通过工具调用按需加载
async function executeLoadSkill(name: string): Promise<string> {
  return fs.readFile(`./skills/${name}.md`, "utf-8");
}
```

**Description 写法原则**：
- 列举触发短语（"deploy my app", "push this live"）
- 定义时序位置（"before writing implementation code"）
- 包含反例——没有反例时准确率从 73% 掉到 53%，加上反例后升到 85%

**路由控制**：每次回复前先扫描 available_skills，有明确匹配时再读取，多个匹配时优先选最具体的，没有匹配就不读取，一次只加载一个。

## 4. 三种压缩策略

| 策略 | 成本 | 丢什么 | 适用场景 |
|------|------|--------|----------|
| 滑动窗口 | 极低 | 早期上下文 | 简短对话 |
| LLM 摘要 | 中 | 细节，保留决策 | 长任务、含关键决策 |
| 工具结果替换 | 极低 | 工具原始输出 | 工具调用密集型 |

**保留优先级**（压缩时）：
1. 架构决策，不得摘要
2. 已修改文件和关键变更
3. 验证状态，pass/fail
4. 未解决的 TODO 和回滚笔记
5. 工具输出，可删，只保留 pass/fail 结论

**关键提醒**：不要改动标识符——UUID、hash、IP、端口、URL、文件名必须原样保留。

## 5. Prompt Caching

KV Cache 的底层原理：如果当前请求的输入前缀和之前某次请求完全一致，KV 就不需要重新计算。

**缓存友好的设计核心是稳定性**：
- 系统提示、工具定义、长文档放前面（稳定前缀）
- 动态信息（当前时间、用户输入、工具调用结果）放在后面
- 任何一个 token 不同都会破坏匹配

**反直觉结论**：稳定的大系统提示，比频繁变动的小提示实际成本更低——写入成本只付一次，后续每次调用读取的折扣可以达到 90%。

## 6. 文件系统作为上下文接口

**Dynamic Context Discovery** 原则：默认少给，只在需要时读取。

- 工具调用返回大量 JSON → 写入文件，Agent 通过 grep/rg 按需读取
- 压缩触发时 → 聊天记录完整保留为文件，摘要里只引用文件路径
- 好处：压缩变成有损但可追溯的操作，不是一次不可恢复的硬截断

## 7. Claude Code 的 System Prompt 组装

Claude Code 的 System Prompt 是多层级动态组装：

```
优先级从高到低：
1. overrideSystemPrompt — 强制覆盖
2. Coordinator prompt — 协调器模式
3. Agent prompt — 用户定义的 Agent prompt
4. customSystemPrompt — --system-prompt 参数
5. defaultSystemPrompt — 标准 prompt
```

组装流程：
1. QueryEngine.ask() 启动
2. 并行获取三大组件：defaultSystemPrompt + systemContext + userContext
3. 静态部分（可全局缓存）+ 动态部分（每用户/会话不同）
4. 缓存分块：静态内容走 KV Cache，动态内容不缓存
