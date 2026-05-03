# Self-Improving Agents

> 来源：深入源码：Hermes Agent 如何实现 "Self-Improving" + 深度解析 Hermes Agent 如何实现"自进化"
> 核心结论：自进化双路径——Skill 生成 + RL 训练数据收集。

## 1. Agent 进化三阶段

```
阶段 1：早期 Agent（被动，指令-响应）
  ↓
阶段 2：自主 Agent（Claude Code / OpenClaw）
  - 自规划、多工具、长程任务
  ↓
阶段 3：自进化 Agent（Hermes）
  - 从执行中学习
  - Skills 自动积累
  - RL 权重更新
```

## 2. 自进化双路径

### 路径 A：Skill 自动生成

从执行轨迹中自动提取可复用的 Skill：

1. **重复工具序列检测**：滑动窗口模式检测，发现频繁出现的工具调用序列
2. **审查信号提取**：从 Self-Review 的 learning-signal 发现中提取改进点
3. **用户纠正捕获**：记录用户手动纠正 Agent 的行为作为训练信号

生成的 Skill 草稿保存到 `.skill-drafts/`，经人工审核后提升到正式 Skill。

### 路径 B：RL 训练数据收集

- 每次执行产生 (state, action, reward) 三元组
- 成功路径 → 正样本
- 失败路径 + 修正 → 对比样本
- 积累到一定规模后用于 RL 微调

## 3. Self-Review 后台审查

Agent 完成一个任务后，后台 fork 一个审查进程：

```
执行轨迹 → 分析器 → 报告 + Nudges
```

**分析维度**：
- 工具错误率：哪些工具频繁出错
- 慢调用：哪些操作超时或过慢
- 循环模式：是否陷入重复尝试
- 错误恢复：失败后是否成功恢复
- 学习信号：哪些行为模式值得固化

**报告保存**：`.reviews/review-{timestamp}-{counter}.json`

## 4. Nudge 反思机制

从审查结果生成优先级化的 Nudge：

| 级别 | 触发条件 | 行为 |
|------|----------|------|
| critical | 安全违规、数据丢失风险 | 立即注入下一轮上下文 |
| warning | 效率低下、重复错误 | 注入下一轮上下文 |
| info | 改进建议 | 累积后批量注入 |

**约束**：
- 每轮最多 3 个 Nudge（避免上下文污染）
- TTL 过期机制（过期自动清除）
- 保存到 `.nudges/` 目录

## 5. 记忆安全扫描

**前置扫描**（写入前）：
- 注入模式检测——防止恶意内容注入记忆
- 密钥扫描——检测 API Key、Token、私钥等敏感信息
- 矛盾检测——与 evergreen memory 对比，发现矛盾
- 主题偏离检测——确保记忆内容与 Agent 职责相关

**自动回滚**：扫描失败时自动拒绝写入，保存扫描报告到 `.memory-scan/`。

## 6. Hermes vs OpenClaw 设计对比

| 维度 | OpenClaw | Hermes |
|------|----------|--------|
| 压缩触发 | 绝对阈值 | 比例阈值（50%） |
| 记忆检索 | 70% 向量 + 30% 关键词 | 双层（文件 + 向量） |
| Skill 管理 | 静态手写 | 动态生成 + 生命周期管理 |
| 自进化 | 无 | Self-Review + Nudge + Skill Gen |
| 评测 | 外部评测 | 内置自动评测闭环 |

## 7. 工程实现要点

### Skill 生成器

```typescript
class SkillGenerator {
  // 从工具序列检测模式
  detectPatterns(sequences: ToolCall[]): SkillDraft[];
  
  // 从审查信号生成
  fromReviewFindings(findings: ReviewFinding[]): SkillDraft[];
  
  // 从用户纠正生成
  fromUserCorrections(corrections: Correction[]): SkillDraft[];
}
```

### 记忆扫描器

```typescript
class MemoryScanner {
  // 注入检测
  scanForInjection(text: text): ScanResult;
  
  // 密钥扫描
  scanForSecrets(text: text): SecretFinding[];
  
  // 矛盾检测
  scanForContradictions(text: text, evergreen: Memory): Contradiction[];
}
```

### 关键原则

1. **扫描前置**：记忆/Skill 写入前扫描，不是写入后
2. **自动回滚**：扫描失败自动拒绝，不靠人工发现
3. **渐进式进化**：先草稿，审核后提升，不直接覆盖
4. **可观测**：所有扫描结果、审查报告、Nudge 都持久化
5. **上下文预算**：Nudge 有数量上限和 TTL，防止上下文污染
