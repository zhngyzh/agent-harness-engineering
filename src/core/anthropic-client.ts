/**
 * Anthropic LLM Client
 *
 * Wraps the Anthropic SDK with our internal types.
 * Supports compatible providers via ANTHROPIC_BASE_URL.
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
	LLMClient,
	LLMResponse,
	Message,
	ToolDefinition,
} from "./types.js";

export class AnthropicClient implements LLMClient {
	private client: Anthropic;
	private _model: string;

	constructor(apiKey?: string, baseUrl?: string, model?: string) {
		const key = apiKey || process.env.ANTHROPIC_API_KEY;
		this.client = new Anthropic({
			apiKey: key,
			baseURL: baseUrl || process.env.ANTHROPIC_BASE_URL || undefined,
			defaultHeaders: {
				Authorization: `Bearer ${key}`,
			},
		});
		this._model = model || process.env.MODEL_ID || "claude-sonnet-4-20250514";
	}

	get model(): string {
		return this._model;
	}

	async messages(
		model: string,
		system: string,
		messages: Message[],
		tools: ToolDefinition[],
		maxTokens: number,
	): Promise<LLMResponse> {
		const sdkMessages = messages.map((m) => ({
			role: m.role as "user" | "assistant",
			content: m.content,
		}));

		const response = await this.client.messages.create({
			model,
			max_tokens: maxTokens,
			system,
			messages: sdkMessages,
			tools: tools as Anthropic.Tool[],
		});

		return {
			content: response.content as LLMResponse["content"],
			stopReason: response.stop_reason as LLMResponse["stopReason"],
			usage: {
				inputTokens: response.usage.input_tokens,
				outputTokens: response.usage.output_tokens,
			},
		};
	}
}

/**
 * Mock client for testing without API calls.
 */
export class MockLLMClient implements LLMClient {
	private responses: LLMResponse[];
	private callCount = 0;

	constructor(responses: LLMResponse[] = []) {
		this.responses = responses;
	}

	async messages(
		_model: string,
		_system: string,
		_messages: Message[],
		_tools: ToolDefinition[],
		_maxTokens: number,
	): Promise<LLMResponse> {
		if (this.callCount < this.responses.length) {
			return this.responses[this.callCount++];
		}
		return {
			content: [{ type: "text", text: "Mock response" }],
			stopReason: "end_turn",
			usage: { inputTokens: 100, outputTokens: 50 },
		};
	}
}
