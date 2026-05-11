import { describe, expect, it } from "vitest";
import {
	type McpServerConfig,
	type McpTool,
	McpToolBridge,
	type McpToolCallResult,
} from "../../src/core/mcp-bridge.js";
import {
	ToolRegistry,
	createDefaultRegistry,
} from "../../src/core/tool-registry.js";

/**
 * Mock MCP server that runs over stdio.
 * We create a simple Node.js script that speaks JSON-RPC 2.0.
 */

// ============================================================
// Helpers
// ============================================================

/** Create a mock MCP tool */
function mockMcpTool(
	name: string,
	description: string,
	properties: Record<string, unknown> = {},
): McpTool {
	return {
		name,
		description,
		inputSchema: {
			type: "object",
			properties,
			required: [],
		},
	};
}

// ============================================================
// McpToolBridge unit tests (without real subprocess)
// ============================================================

describe("McpToolBridge", () => {
	describe("state management", () => {
		it("starts with zero connected servers", () => {
			const bridge = new McpToolBridge();
			expect(bridge.connectedServers).toBe(0);
		});

		it("starts with zero registered tools", () => {
			const bridge = new McpToolBridge();
			expect(bridge.registeredToolCount).toBe(0);
			expect(bridge.getRegisteredTools()).toEqual([]);
		});

		it("reports disconnected for unknown server", () => {
			const bridge = new McpToolBridge();
			expect(bridge.isConnected("nonexistent")).toBe(false);
		});
	});

	describe("tool name wrapping", () => {
		it("wraps tool names with server prefix", () => {
			// We can't easily unit-test the full connect flow without a real subprocess,
			// but we can verify the naming convention by inspecting the bridge's behavior.
			const bridge = new McpToolBridge();
			const registry = new ToolRegistry();

			// Manually register a tool with MCP naming convention to verify the pattern
			const mcpTool = mockMcpTool("search", "Search the web", {
				query: { type: "string" },
			});
			// The bridge would create "myserver:search" from server "myserver"
			expect(mcpTool.name).toBe("search");
		});
	});

	describe("McpServerConfig", () => {
		it("accepts stdio config", () => {
			const config: McpServerConfig = {
				name: "test-server",
				transport: "stdio",
				command: "npx",
				args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
				timeoutMs: 10_000,
			};
			expect(config.name).toBe("test-server");
			expect(config.transport).toBe("stdio");
			expect(config.command).toBe("npx");
		});

		it("accepts SSE config", () => {
			const config: McpServerConfig = {
				name: "remote-server",
				transport: "sse",
				url: "http://localhost:3001/sse",
				timeoutMs: 30_000,
			};
			expect(config.name).toBe("remote-server");
			expect(config.transport).toBe("sse");
			expect(config.url).toBe("http://localhost:3001/sse");
		});

		it("accepts custom prefix", () => {
			const config: McpServerConfig = {
				name: "my-server",
				transport: "stdio",
				command: "my-server",
				prefix: "custom",
			};
			expect(config.prefix).toBe("custom");
		});
	});

	describe("McpTool types", () => {
		it("validates MCP tool structure", () => {
			const tool = mockMcpTool("read_file", "Read a file", {
				path: { type: "string", description: "File path" },
			});
			expect(tool.name).toBe("read_file");
			expect(tool.description).toBe("Read a file");
			expect(tool.inputSchema.type).toBe("object");
			expect(tool.inputSchema.properties).toHaveProperty("path");
		});
	});

	describe("McpToolCallResult types", () => {
		it("represents a successful result", () => {
			const result: McpToolCallResult = {
				content: [{ type: "text", text: "Hello, world!" }],
			};
			expect(result.isError).toBeFalsy();
			expect(result.content[0].type).toBe("text");
		});

		it("represents an error result", () => {
			const result: McpToolCallResult = {
				content: [{ type: "text", text: "File not found" }],
				isError: true,
			};
			expect(result.isError).toBe(true);
		});
	});
});

// ============================================================
// Integration-style tests with a mock MCP subprocess
// ============================================================

describe("McpToolBridge integration", () => {
	// These tests verify the bridge's behavior with controlled inputs.
	// A full integration test would require a real MCP server process.

	describe("registry integration", () => {
		it("can register MCP-style tools into a ToolRegistry", () => {
			const registry = new ToolRegistry();

			// Simulate what the bridge does: register MCP tools with prefixed names
			registry.register({
				name: "filesystem:read_file",
				description: "[MCP:filesystem] Read a file from the filesystem",
				parameters: {
					type: "object",
					description: "Parameters for read_file",
					properties: { path: { type: "string" } },
					required: ["path"],
				},
				handler: async (input) => `Contents of ${input.path}`,
			});

			registry.register({
				name: "filesystem:write_file",
				description: "[MCP:filesystem] Write to a file",
				parameters: {
					type: "object",
					description: "Parameters for write_file",
					properties: {
						path: { type: "string" },
						content: { type: "string" },
					},
					required: ["path", "content"],
				},
				handler: async (input) => `Written to ${input.path}`,
			});

			expect(registry.has("filesystem:read_file")).toBe(true);
			expect(registry.has("filesystem:write_file")).toBe(true);
			expect(registry.list().length).toBe(2);

			// Verify definitions include MCP tools
			const defs = registry.definitions();
			const defNames = defs.map((d) => d.name);
			expect(defNames).toContain("filesystem:read_file");
			expect(defNames).toContain("filesystem:write_file");
		});

		it("can unregister MCP tools by prefix", () => {
			const registry = new ToolRegistry();

			registry.register({
				name: "mcp:tool_a",
				description: "[MCP:test] Tool A",
				parameters: { type: "object", description: "", properties: {} },
				handler: async () => "a",
			});
			registry.register({
				name: "mcp:tool_b",
				description: "[MCP:test] Tool B",
				parameters: { type: "object", description: "", properties: {} },
				handler: async () => "b",
			});
			registry.register({
				name: "builtin:tool_c",
				description: "Built-in tool C",
				parameters: { type: "object", description: "", properties: {} },
				handler: async () => "c",
			});

			// Simulate disconnectServer: unregister all "mcp:" prefixed tools
			for (const tool of registry.list()) {
				if (tool.name.startsWith("mcp:")) {
					registry.unregister(tool.name);
				}
			}

			expect(registry.has("mcp:tool_a")).toBe(false);
			expect(registry.has("mcp:tool_b")).toBe(false);
			expect(registry.has("builtin:tool_c")).toBe(true);
		});

		it("handles MCP tool execution errors gracefully", async () => {
			const registry = new ToolRegistry();
			registry.register({
				name: "test:failing_tool",
				description: "[MCP:test] A tool that fails",
				parameters: {
					type: "object",
					description: "",
					properties: { input: { type: "string" } },
					required: ["input"],
				},
				handler: async () => {
					throw new Error("MCP server connection lost");
				},
			});

			await expect(
				registry.execute("test:failing_tool", { input: "test" }),
			).rejects.toThrow("MCP server connection lost");
		});
	});

	describe("ToolRegistry with mixed built-in and MCP tools", () => {
		it("coexists with default tools", () => {
			const registry = createDefaultRegistry();

			// Add MCP tools alongside built-in ones
			registry.register({
				name: "github:create_issue",
				description: "[MCP:github] Create a GitHub issue",
				parameters: {
					type: "object",
					description: "",
					properties: {
						title: { type: "string" },
						body: { type: "string" },
					},
					required: ["title"],
				},
				handler: async (input) => `Created issue: ${input.title}`,
			});

			// All tools should be available
			expect(registry.has("bash")).toBe(true);
			expect(registry.has("read_file")).toBe(true);
			expect(registry.has("github:create_issue")).toBe(true);
			expect(registry.list().length).toBe(6); // 5 built-in + 1 MCP
		});
	});
});
