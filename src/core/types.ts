/**
 * Core type definitions for the Agent Harness.
 *
 * Design principles from knowledge base:
 * - Messages are immutable facts, mutated only by appending
 * - Tools follow ACI (Agent-Computer Interface) design: goal-oriented, not API wrapping
 * - Session state is externalized, never embedded in the model's context
 */

// ============================================================
// Message Types
// ============================================================

export type Role = "user" | "assistant" | "system";

export interface TextContent {
	type: "text";
	text: string;
}

export interface ToolUseContent {
	type: "tool_use";
	id: string;
	name: string;
	input: Record<string, unknown>;
}

export interface ToolResultContent {
	type: "tool_result";
	tool_use_id: string;
	content: string;
	is_error?: boolean;
}

export type MessageContent = TextContent | ToolUseContent | ToolResultContent;

export interface Message {
	role: Role;
	content: MessageContent[] | string;
}

// ============================================================
// Tool Types (ACI Generation 2: goal-oriented)
// ============================================================

export interface ToolParameter {
	type: "string" | "number" | "boolean" | "array" | "object";
	description: string;
	enum?: (string | number)[];
	items?: ToolParameter;
	properties?: Record<string, unknown>;
	required?: string[];
}

export interface Tool {
	name: string;
	description: string;
	parameters: ToolParameter;
	handler: (input: Record<string, unknown>) => Promise<string> | string;
}

export interface ToolDefinition {
	name: string;
	description: string;
	input_schema: {
		type: "object";
		properties: Record<string, unknown>;
		required?: string[];
	};
}

// ============================================================
// Session Types
// ============================================================

export interface SessionMeta {
	id: string;
	agentName: string;
	createdAt: string;
	updatedAt: string;
	messageCount: number;
	totalTokens: number;
	status: "active" | "compacted" | "archived";
}

export interface SessionLine {
	type: "message" | "meta" | "compact";
	data: Message | SessionMeta | CompactRecord;
	timestamp: string;
}

export interface CompactRecord {
	reason: "auto" | "manual" | "overflow";
	messagesBefore: number;
	messagesAfter: number;
	summary: string;
}

// ============================================================
// Agent Config
// ============================================================

export interface AgentConfig {
	name: string;
	model: string;
	systemPrompt?: string;
	workspaceDir: string;
	maxTokens: number;
	temperature?: number;
	maxTurns: number;
	maxContextTokens: number;
	language: string;
	channel: "cli" | "websocket" | "telegram";
}

export const DEFAULT_CONFIG: AgentConfig = {
	name: "Luna",
	model: "claude-sonnet-4-20250514",
	workspaceDir: "./workspace",
	maxTokens: 8096,
	temperature: 0.7,
	maxTurns: 50,
	maxContextTokens: 100_000,
	language: "zh",
	channel: "cli",
};

// ============================================================
// LLM Provider Types
// ============================================================

export interface LLMResponse {
	content: MessageContent[];
	stopReason: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence";
	usage: {
		inputTokens: number;
		outputTokens: number;
	};
}

export interface LLMClient {
	messages(
		model: string,
		system: string,
		messages: Message[],
		tools: ToolDefinition[],
		maxTokens: number,
	): Promise<LLMResponse>;
}

// ============================================================
// Event Types (Observability)
// ============================================================

export type AgentEventType =
	| "agent_start"
	| "agent_end"
	| "turn_start"
	| "turn_end"
	| "tool_start"
	| "tool_end"
	| "tool_error"
	| "session_created"
	| "session_compact"
	| "error";

export interface AgentEvent {
	type: AgentEventType;
	sessionId: string;
	timestamp: string;
	data: Record<string, unknown>;
}

export type EventHandler = (event: AgentEvent) => void;
