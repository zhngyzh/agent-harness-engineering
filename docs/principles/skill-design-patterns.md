# Skill 设计模式

> 来源：工作流的Skill怎么写？从7个顶级Skill中提炼的模式与最佳实践
> 核心结论：Skill = 知识注入，描述符决定路由准确率。

## 1. Skill 是什么

Skill 是一个文件夹，核心是 SKILL.md 文件，使用 **YAML frontmatter + Markdown 正文**格式。

```
my-skill/
├── SKILL.md              # 主文件（必须）
├── scripts/              # 可执行脚本（可选）
├── references/           # 详细参考文档（可选，按需加载）
├── resources/            # 模板、清单等资源（可选）
└── examples/             # 示例（可选）
```

**关键机制**：Skill 本质是"知识注入"——它不会动态生成新工具，而是把指令文本注入到 LLM 的上下文中，LLM 用已有的工具来执行这些指令。

## 2. Frontmatter 设计

**必填字段**：
- `name`：唯一标识符，小写连字符
- `description`：**最关键**——LLM 通过它决定是否加载

**Description 写法**：

```yaml
# ✅ 好——包含触发短语和关键词
description: >
  Deploy applications to Vercel. Use when the user requests
  deployment actions like "deploy my app" or "push this live".

# ✅ 好——定义时序位置
description: Use when implementing any feature or bugfix, before writing implementation code.

# ❌ 差——太模糊
description: Helps with deployment stuff
```

**核心原则**：
- 列举触发短语（用户可能说的话）
- 定义时序位置（在什么之前/之后使用）
- 包含产品关键词（覆盖大平台时列出所有产品名）
- **包含反例**——没有反例时准确率从 73% 掉到 53%，加上反例后升到 85%

## 3. 五种核心设计模式

### 模式 1：线性流程

**适用**：部署、安装、迁移等有明确步骤的操作。

```
# 标题
## Prerequisites（前置条件）
## Quick Start（主流程：Step 1 → 2 → 3）
## Fallback（降级方案）
## Troubleshooting（故障排除）
```

**关键技巧**：
- **安全默认值**："Always deploy as preview, not production"
- **具体命令**：每步给出可直接执行的 bash 命令
- **超时提示**："Use a 10 minute (600000ms) timeout"
- **负面指令**："Do not curl the deployed URL to verify"

### 模式 2：决策树 + 按需加载

**适用**：大型平台选型、产品导航、问题诊断。

```
# 标题
## Authentication（认证前置）
## Quick Decision Trees（按用户意图分类）
## Product Index（产品索引表）
```

**关键技巧**：
- 用户意图分类用用户语言而非技术术语
- 树形导航帮助 LLM 快速定位
- 渐进式披露：主文件小，references/ 按需展开

### 模式 3：循环迭代

**适用**：TDD、代码审查、设计评审等需要反复执行的流程。

```
# 标题
## The Iron Law（铁律）
## Red-Green-Refactor（循环体）
## Common Rationalizations（借口反驳表）
## Verification Checklist（退出条件）
```

**关键技巧**：
- **强硬语气**："Delete it. Start over."——LLM 倾向于灵活变通
- **借口反驳表**：预判 LLM 可能的偷懒借口并逐一反驳
- **量化阈值**：给出硬性的最低标准
- **Good/Bad 对比**：对比教学效果最好

### 模式 4：接力棒循环（跨 Session 持久化）

**适用**：多次迭代的长期项目，需要跨多个 session 持续工作。

```
# 标题
## The Baton System（接力棒文件规范）
## Execution Protocol（6 步执行协议）
  ### Step 1: Read the Baton
  ### Step 6: Prepare the Next Baton ⚠️（关键！）
```

**关键技巧**：
- **文件即状态**：next-prompt.md 作为接力棒
- **续命机制**：写下一个接力棒标记为 Critical + MUST
- **编排无关**：同一个 Skill 适配多种自动化环境

### 模式 5：多阶段 + 检查点 + Skill 编排

**适用**：复杂的多周流程，需要在关键节点做 Go/No-Go 决策。

```
# 标题
## Phase 1: Frame the Problem
  ### Activities（调用哪些子 Skill）
  ### Outputs（阶段产出）
  ### Decision Point 1（检查点）
## Phase 2-6...（重复相同结构）
```

## 4. 特殊模式：思维框架

**适用**：安全审计、代码审查、架构分析等需要深度思考的场景。

**关键技巧**：
- 给 LLM 分析框架而非具体命令（第一性原理、5 Why、5 How）
- 量化阈值强制达到足够的分析深度
- 非目标约束——克制 LLM 最想做的事，先理解再判断
- 反幻觉规则——防止 LLM 自我欺骗

## 5. 防止 LLM 偷懒的 4 种武器

| 武器 | 原理 |
|------|------|
| 强硬语气 | LLM 对命令式语气的遵从率更高 |
| 借口反驳表 | 预判 LLM 的自我合理化路径并堵死 |
| 量化阈值 | 给出硬性的最低标准 |
| 负面指令 | 明确说"不要做 X" |

## 6. 知识组织三层架构

```
第 1 层：Frontmatter（~100 tokens）→ LLM 扫描 description 决定是否加载
第 2 层：SKILL.md 正文（<5K tokens）→ 核心指令、决策树、流程步骤
第 3 层：references/ 和 resources/ → 按需加载
```

**Token 预算**：
- Frontmatter: ~100 tokens
- 主文件: 2K-5K tokens
- 总上下文占用: <10K tokens（主文件 + 1-2 个参考文档）

## 7. 模式选择决策树

```
你的 Skill 需要做什么？
├─ 执行有明确步骤的操作 → 模式 1：线性流程
├─ 在大量选项中帮用户选择 → 模式 2：决策树
├─ 单次会话中反复执行 → 模式 3：循环迭代
├─ 跨多个 session 持续推进 → 模式 4：接力棒循环
├─ 跨越多天/多周，有阶段划分 → 模式 5：多阶段
└─ 需要深度分析而非快速执行 → 特殊模式：思维框架
```
