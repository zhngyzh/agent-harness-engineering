/**
 * Agent Harness Engineering — Barrel Exports
 *
 * Public API surface for using the agent harness as a library.
 */

// Core
export { AgentLoop } from "./core/agent-loop.js";
export { AnthropicClient, MockLLMClient } from "./core/anthropic-client.js";
export {
	ToolRegistry,
	createDefaultRegistry,
	ToolError,
} from "./core/tool-registry.js";
export { SessionStore } from "./core/session.js";
export { McpToolBridge } from "./core/mcp-bridge.js";
export type {
	McpServerConfig,
	McpTool,
	McpToolCallResult,
} from "./core/mcp-bridge.js";
export {
	MAX_FILE_CHARS,
	MAX_TOTAL_BOOTSTRAP_CHARS,
	MAX_SKILLS,
	MAX_SKILLS_PROMPT_CHARS,
	COMPACTION_THRESHOLD,
	COMPACTION_TARGET,
	MICRO_COMPACT_TRUNCATE_CHARS,
	DELIVERY_BASE_DELAY_S,
	DELIVERY_BACKOFF_MULTIPLIER,
	DELIVERY_MAX_RETRIES,
	DELIVERY_JITTER_RATIO,
	BOOTSTRAP_FILES,
	SESSION_FILE_EXT,
	INJECTION_PATTERNS,
	CACHE_BOUNDARY,
} from "./core/constants.js";
export { DEFAULT_CONFIG } from "./core/types.js";
export type {
	AgentConfig,
	AgentEvent,
	AgentEventType,
	EventHandler,
	LLMClient,
	LLMResponse,
	Message,
	MessageContent,
	Role,
	SessionMeta,
	TextContent,
	Tool,
	ToolDefinition,
	ToolParameter,
	ToolUseContent,
	ToolResultContent,
} from "./core/types.js";

// Context
export { BootstrapLoader } from "./context/bootstrap.js";
export type { BootstrapFile, BootstrapResult } from "./context/bootstrap.js";
export { SystemPromptBuilder } from "./context/builder.js";
export type {
	SystemPromptLayers,
	SkillSummary,
	MemoryEntry,
	RuntimeInfo,
} from "./context/builder.js";
export { ContextCompactor, microCompact } from "./context/compaction.js";
export type { CompactionResult } from "./context/compaction.js";
export { splitCacheBlocks, cacheRatio } from "./context/cache.js";
export type { CacheBlock } from "./context/cache.js";

// Intelligence
export { MemoryStore } from "./intelligence/memory.js";
export type { MemoryFact, MemorySearchResult } from "./intelligence/memory.js";
export { SkillsManager, SkillScanner } from "./intelligence/skills.js";
export type {
	Skill,
	SkillFrontmatter,
	SkillSummary as SkillSummaryType,
} from "./intelligence/skills.js";

// Channels
export { CLIChannel } from "./channels/cli.js";
export { Gateway } from "./channels/gateway.js";
export type {
	InboundMessage,
	OutboundMessage,
	Channel,
} from "./channels/base.js";

// Delivery
export { DeliveryQueue } from "./delivery/queue.js";
export type { QueuedMessage } from "./delivery/queue.js";

// Concurrency
export { LaneQueue, CommandQueue } from "./concurrency/lanes.js";
export { CronScheduler, HeartbeatRunner } from "./concurrency/heartbeat.js";

// Collaboration
export { SubagentManager } from "./collaboration/subagent.js";
export type {
	SubagentResult,
	SubagentOptions,
} from "./collaboration/subagent.js";
export { TeamMailbox } from "./collaboration/team.js";
export type { TeamMessage } from "./collaboration/team.js";

// Evolution
export { SelfReviewAnalyzer } from "./evolution/self-review.js";
export type { ReviewReport, ReviewFinding } from "./evolution/self-review.js";
export { SkillGenerator } from "./evolution/skill-generator.js";
export { MemoryScanner } from "./evolution/memory-scan.js";
export type {
	ScanResult as MemoryScanResult,
	ScanFinding as MemoryScanFinding,
} from "./evolution/memory-scan.js";
export { NudgeEngine } from "./evolution/nudge.js";

// Evaluation
export {
	DeterministicGrader,
	HeuristicGrader,
	LLMJudgeGrader,
	EvalRunner,
} from "./evaluation/graders.js";
export { MetricsCalculator } from "./evaluation/metrics.js";
export { OnlineSampler } from "./evaluation/sampler.js";

// Security
export { PermissionEngine } from "./security/permissions.js";
export type {
	PermissionRule,
	PermissionDecision,
	PermissionRequest,
	PermissionResult,
} from "./security/permissions.js";
export { InjectionDefense } from "./security/injection.js";
export type {
	ScanResult as InjectionScanResult,
	InjectionRisk,
	InjectionFinding,
} from "./security/injection.js";
export { HookSystem } from "./security/hooks.js";
export { Sandbox } from "./security/sandbox.js";

// Observability
export { EventBus } from "./observability/events.js";
export { Logger, createLogger } from "./observability/logger.js";
export { Tracing } from "./observability/tracing.js";
export type { Trace, ToolSpan } from "./observability/tracing.js";
