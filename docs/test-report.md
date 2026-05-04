# 生产性测试报告

> 测试日期: 2026-05-04
> 测试方法: 通过 MockLLMClient 控制 LLM 响应，模拟多轮对话场景
> 测试文件: `tests/unit/production-p0.test.ts`, `production-p1.test.ts`, `production-p2.test.ts`

---

## 测试结果总览

| 指标 | 数值 |
|------|------|
| 新增测试 | 41 |
| 通过 | 41 |
| 失败 | 0 |
| 原有测试 | 336 |
| 原有测试通过 | 336 |
| **总计** | **377 全部通过** |

---

## 发现的 Bug（按严重程度排序）

### 🔴 Bug #1：TF-IDF IDF 计算错误（影响 Memory 搜索）

**严重程度**: 高
**模块**: `src/intelligence/memory.ts` → `TFIDF` 类
**影响**: 先写入的记忆永远无法被 TF-IDF 搜索找到

**根因**: `addDocument()` 方法只在添加新文档时更新新文档的 unique tokens 的 IDF，不重新计算已有文档的 token 的 IDF。

```typescript
// 当前代码（有 bug）:
addDocument(text: string): number {
  this.docs.push(tokens);
  this.docCount++;
  const unique = new Set(tokens);
  for (const token of unique) {
    const count = this.docs.filter(d => d.includes(token)).length;
    this.idf.set(token, Math.log(this.docCount / count));  // 只更新新文档的 tokens
  }
}
```

**复现**:
1. 写入 "The quick brown fox" → docCount=1, 所有 token 的 IDF=log(1/1)=0
2. 写入 "Lazy dogs sleep" → docCount=2, 只更新 "lazy", "dogs", "sleep" 的 IDF
3. 搜索 "quick brown fox" → TF-IDF 分数 = tf × 0 = 0 → 无结果

**修复方案**: 每次 `addDocument` 后，重新计算 ALL tokens 的 IDF：
```typescript
for (const token of this.idf.keys()) {
  const count = this.docs.filter(d => d.includes(token)).length;
  this.idf.set(token, Math.log(this.docCount / count));
}
```

---

### 🔴 Bug #2：InjectionDefense `/g` 标志导致间歇性检测失败

**严重程度**: 高
**模块**: `src/security/injection.ts`
**影响**: 连续扫描相同模式的注入时，第二次扫描可能漏报

**根因**: `ROLE_MARKERS` 和 `DELIMITER_PATTERNS` 的正则表达式使用了 `/g` 标志。当使用 `.test()` 方法时，`/g` 标志会导致 `lastIndex` 状态残留：

```javascript
const p = /<system>/gi;
p.test("<system>");  // → true, lastIndex = 8
p.test("<system>");  // → false!（从位置 8 开始搜索，字符串长度=8，无匹配）
p.test("<system>");  // → true（lastIndex 已重置为 0）
```

**影响范围**: `DELIMITER_PATTERNS` 中的所有模式（`<system>`, `</system>`, `<instructions>`, `[SYSTEM]`, `[INST]` 等）和 `ROLE_MARKERS` 中的所有模式。

**修复方案**: 移除 `/g` 标志（`.test()` 不需要它），或在每次 `.test()` 前重置 `lastIndex = 0`：
```typescript
// 方案 1: 移除 /g 标志
const DELIMITER_PATTERNS = [
  /<system>/i,    // 去掉 g
  /<\/system>/i,
  // ...
];

// 方案 2: 在 scan() 中重置
for (const delim of DELIMITER_PATTERNS) {
  delim.lastIndex = 0;  // 重置状态
  if (delim.test(input)) { /* ... */ }
}
```

---

### 🟡 Bug #3：Subagent timeout 状态映射错误

**严重程度**: 中
**模块**: `src/collaboration/subagent.ts`
**影响**: 调用方无法区分 timeout 和其他类型的失败

**根因**: `SubagentResult.status` 类型定义了 `"timeout"` 作为可能值，但 `spawn()` 的 catch 块始终返回 `status: "failed"`：

```typescript
// subagent.ts 第 75-82 行:
return {
  id,
  status: "failed",  // ← 应该是 "timeout" 当 err.message === "Subagent timeout"
  summary,
  turns,
  durationMs,
  error: (err as Error).message,
};
```

**修复方案**:
```typescript
const isTimeout = (err as Error).message === "Subagent timeout";
return {
  id,
  status: isTimeout ? "timeout" : "failed",
  // ...
};
```

---

### 🟡 Bug #4：Session 消息重复写入

**严重程度**: 中
**模块**: `src/core/agent-loop.ts` + `src/core/session.ts`
**影响**: 会话文件中消息重复，膨胀存储空间

**根因**: `AgentLoop.sendMessage()` 每次都将完整的 `this.messages` 数组传给 `session.appendMessages()`，而 `appendMessages()` 直接追加所有消息，不检查哪些是新消息：

```
Turn 1: messages = [user1, asst1] → 写入 2 条
Turn 2: messages = [user1, asst1, user2, asst2] → 写入 4 条（user1, asst1 重复）
Turn 3: messages = [user1, asst1, user2, asst2, user3, asst3] → 写入 6 条
总计: 12 条写入，实际只有 6 条唯一消息
```

**修复方案**: 在 SessionStore 中跟踪已写入的偏移量，只追加新消息：
```typescript
appendMessages(messages: Message[]): void {
  const newMessages = messages.slice(this.messageCount);
  // ... 只写入 newMessages
  this.messageCount = messages.length;
}
```

---

### 🟢 Bug #5：Self-Review 每次创建新文件

**严重程度**: 低
**模块**: `src/evolution/self-review.ts`
**影响**: 多次 review 分散在多个文件中，不便查阅

**根因**: `analyze()` 每次调用都使用时间戳生成新文件名（`review-${timestamp}-${id}`），而不是追加到当天的文件中。

**修复方案**: 使用日期作为文件名（如 `reviews-${today}.jsonl`），多次 review 追加到同一文件。

---

### 🟢 Bug #6：Session listSessions 与 meta 文件不同步

**严重程度**: 低
**模块**: `src/core/session.ts`
**影响**: 刚创建但尚未写入消息的会话不出现在 listSessions 中

**根因**: `listSessions()` 只扫描 `.jsonl` 文件，但 `SessionStore` 构造函数会创建 `_meta.json` 文件（即使没有消息）。

**修复方案**: `listSessions()` 同时扫描 meta 文件，或构造函数延迟创建 meta 文件直到首次写入。

---

### 🟢 Bug #7：Tracing totalTokens 永远为 0

**严重程度**: 低
**模块**: `src/observability/tracing.ts`
**影响**: Trace 中的 token 使用量始终为 0

**根因**: `totalTokens` 字段在 `Trace` 接口中定义并初始化为 0，但 `Tracing` 类中没有任何代码更新它。Token 计数需要在 `AgentLoop` 或 `AnthropicClient` 中完成。

**修复方案**: 在 `AgentLoop.callLLM()` 返回后，将 `response.usage` 累加到 `tracing.trace.totalTokens`。

---

## 架构发现（非 Bug，但值得关注）

### 发现 #1：CLI 未使用 Context Builder / Compaction / Skills / Memory

`src/entrypoints/cli.ts` 使用简化的 `buildSystemPrompt()` 函数，只加载 4 个 workspace 文件（SOUL.md, IDENTITY.md, TOOLS.md, MEMORY.md）。整个 `src/context/builder.ts`、`src/context/compaction.ts`、`src/intelligence/skills.ts` 和 `src/intelligence/memory.ts` 模块在 CLI 路径中**完全未被使用**。

这是架构设计上的分离 — CLI 是简化入口，完整功能通过模块 API 提供。但用户可能期望 CLI 具备完整的 context engineering 能力。

### 发现 #2：InjectionDefense 和 MemoryScanner 共享 INJECTION_PATTERNS

`src/core/constants.ts` 中的 `INJECTION_PATTERNS` 被 `InjectionDefense` 和 `MemoryScanner` 共同使用。修改时需要同步更新两处的测试。

---

## 测试覆盖矩阵

| 模块 | 单元测试 | 生产性测试 | 发现 Bug |
|------|---------|-----------|----------|
| Agent Loop | ✅ 6 tests | ✅ 5 scenarios | — |
| Session | ✅ 4 tests | ✅ 3 scenarios | #4, #6 |
| Compaction | ✅ (context.test) | ✅ 3 scenarios | — |
| Memory | ✅ (intelligence.test) | ✅ 4 scenarios | **#1** |
| Skills | ✅ (intelligence.test) | ✅ 2 scenarios | — |
| Subagent | ✅ 7 tests | ✅ 3 scenarios | **#3** |
| Tracing | ✅ (events-logger.test) | ✅ 4 scenarios | #7 |
| Injection | ✅ (security.test) | ✅ 4 scenarios | **#2** |
| Self-Review | ✅ (evolution.test) | ✅ 1 scenario | #5 |
| Bootstrap | ✅ (context.test) | ✅ 3 scenarios | — |
| Lanes | ✅ (lanes.test) | ✅ 2 scenarios | — |
| Delivery | ✅ (channels-delivery.test) | — | — |
| Heartbeat | ✅ (heartbeat.test) | — | — |
| Evaluation | ✅ (evaluation.test) | — | — |

---

## 修复优先级

| 优先级 | Bug | 预计工作量 |
|--------|-----|-----------|
| P0 | #1 TF-IDF IDF 计算错误 | 30 分钟 |
| P0 | #2 /g 标志间歇性失败 | 15 分钟 |
| P1 | #3 Subagent timeout 状态映射 | 10 分钟 |
| P1 | #4 Session 消息重复写入 | 30 分钟 |
| P2 | #5 Self-Review 文件创建 | 15 分钟 |
| P2 | #6 listSessions 不同步 | 15 分钟 |
| P2 | #7 totalTokens 为 0 | 20 分钟 |
