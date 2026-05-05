/**
 * MCP (Model Context Protocol) Tool Bridge
 *
 * Connects to MCP servers and dynamically imports their tools into the
 * agent's ToolRegistry. This allows the agent to use any MCP-compatible
 * tool without hard-coding it.
 *
 * Architecture:
 *
 *   MCP Server ←→ McpClient → McpToolBridge → ToolRegistry
 *                  (stdio/SSE)   (adapter)      (dispatch)
 *
 * Two transport modes:
 *   1. stdio — spawn the MCP server as a subprocess, communicate via stdin/stdout
 *   2. SSE   — connect to a remote MCP server via HTTP/SSE
 *
 * The bridge:
 *   - Connects to the MCP server and lists available tools
 *   - Wraps each MCP tool as a local Tool that delegates to the server
 *   - Registers all wrapped tools into the ToolRegistry
 *   - Handles reconnection and error recovery
 *
 * Design principles:
 *   - MCP tools are treated as first-class citizens alongside built-in tools
 *   - Tool names are prefixed with the server name to avoid collisions
 *   - Connection lifecycle is managed explicitly (connect/disconnect)
 *   - All MCP errors are translated to ToolError with suggestions
 */

import { spawn, type ChildProcess } from "node:child_process";
import { Logger } from "../observability/logger.js";
import { ToolError, ToolRegistry } from "./tool-registry.js";
import type { Tool } from "./types.js";

// ============================================================
// MCP Protocol Types
// ============================================================

export interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface McpToolCallResult {
  content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>;
  isError?: boolean;
}

export interface McpServerConfig {
  name: string;
  transport: "stdio" | "sse";
  // For stdio: command + args
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  // For SSE: URL
  url?: string;
  // Timeout for tool calls (ms)
  timeoutMs?: number;
  // Tool name prefix (default: server name)
  prefix?: string;
}

// ============================================================
// MCP Client (JSON-RPC 2.0 over stdio)
// ============================================================

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

class McpStdioClient {
  private process: ChildProcess | null = null;
  private log: Logger;
  private requestId = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private buffer = "";
  private connected = false;

  constructor(private config: McpServerConfig) {
    this.log = new Logger(`mcp:${config.name}`);
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    return new Promise((resolve, reject) => {
      try {
        this.process = spawn(this.config.command!, this.config.args || [], {
          env: { ...process.env, ...this.config.env },
          stdio: ["pipe", "pipe", "pipe"],
        });

        this.process.stdout!.on("data", (data: Buffer) => {
          this.buffer += data.toString();
          this.processBuffer();
        });

        this.process.stderr!.on("data", (data: Buffer) => {
          this.log.debug(`stderr: ${data.toString().trim()}`);
        });

        this.process.on("error", (err) => {
          this.log.error(`Process error: ${err.message}`);
          reject(err);
        });

        this.process.on("exit", (code) => {
          this.connected = false;
          this.log.warn(`Process exited with code ${code}`);
          // Reject all pending requests
          for (const [, pending] of this.pending) {
            pending.reject(new Error(`MCP server exited with code ${code}`));
          }
          this.pending.clear();
        });

        this.connected = true;
        this.log.info(`Connected to MCP server: ${this.config.name}`);
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  }

  async disconnect(): Promise<void> {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    this.connected = false;
    this.pending.clear();
    this.log.info(`Disconnected from MCP server: ${this.config.name}`);
  }

  async listTools(): Promise<McpTool[]> {
    const response = await this.request("tools/list", {});
    const tools = (response as { tools: McpTool[] }).tools;
    this.log.info(`Discovered ${tools.length} tools from ${this.config.name}`);
    return tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolCallResult> {
    const response = await this.request("tools/call", {
      name,
      arguments: args,
    });
    return response as McpToolCallResult;
  }

  /** Perform MCP initialize handshake */
  async initialize(): Promise<void> {
    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "agent-harness", version: "0.1.0" },
    });
    this.log.info("MCP handshake complete");
  }

  isConnected(): boolean {
    return this.connected;
  }

  // ============================================================
  // Private
  // ============================================================

  private async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (!this.connected || !this.process) {
      throw new Error(`MCP server ${this.config.name} is not connected`);
    }

    const id = ++this.requestId;
    const request: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request timeout: ${method}`));
      }, this.config.timeoutMs || 30_000);

      this.pending.set(id, {
        resolve: (v: unknown) => {
          clearTimeout(timeout);
          resolve(v);
        },
        reject: (e: Error) => {
          clearTimeout(timeout);
          reject(e);
        },
      });

      const line = JSON.stringify(request) + "\n";
      this.process!.stdin!.write(line);
    });
  }

  private processBuffer(): void {
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const response: JsonRpcResponse = JSON.parse(line);
        const pending = this.pending.get(response.id);
        if (!pending) continue;

        this.pending.delete(response.id);
        if (response.error) {
          pending.reject(new Error(`MCP error ${response.error.code}: ${response.error.message}`));
        } else {
          pending.resolve(response.result);
        }
      } catch {
        // Skip malformed JSON lines
      }
    }
  }
}

// ============================================================
// MCP Tool Bridge
// ============================================================

export class McpToolBridge {
  private log = new Logger("mcp-bridge");
  private clients = new Map<string, McpStdioClient>();
  private registeredTools = new Set<string>();

  /**
   * Connect to an MCP server and register all its tools into the registry.
   */
  async connectServer(config: McpServerConfig, registry: ToolRegistry): Promise<number> {
    const client = new McpStdioClient(config);
    await client.connect();

    // Initialize the MCP server (handshake)
    await client.initialize();

    // List and register tools
    const mcpTools = await client.listTools();
    const prefix = config.prefix ? `${config.prefix}:` : `${config.name}:`;

    for (const mcpTool of mcpTools) {
      const toolName = `${prefix}${mcpTool.name}`;
      const tool = this.wrapMcpTool(toolName, mcpTool, client, config.name);
      registry.register(tool);
      this.registeredTools.add(toolName);
    }

    this.clients.set(config.name, client);
    this.log.info(
      `Registered ${mcpTools.length} tools from MCP server "${config.name}" (prefix: "${prefix}")`,
    );
    return mcpTools.length;
  }

  /**
   * Disconnect from a specific MCP server and unregister its tools.
   */
  async disconnectServer(serverName: string, registry: ToolRegistry): Promise<void> {
    const client = this.clients.get(serverName);
    if (!client) return;

    // Unregister all tools from this server
    for (const toolName of this.registeredTools) {
      if (toolName.startsWith(`${serverName}:`)) {
        registry.unregister(toolName);
        this.registeredTools.delete(toolName);
      }
    }

    await client.disconnect();
    this.clients.delete(serverName);
    this.log.info(`Disconnected from MCP server: ${serverName}`);
  }

  /**
   * Disconnect from all MCP servers.
   */
  async disconnectAll(registry: ToolRegistry): Promise<void> {
    for (const [name] of this.clients) {
      await this.disconnectServer(name, registry);
    }
  }

  /**
   * Get the number of connected MCP servers.
   */
  get connectedServers(): number {
    return this.clients.size;
  }

  /**
   * Get the number of registered MCP tools.
   */
  get registeredToolCount(): number {
    return this.registeredTools.size;
  }

  /**
   * List all registered MCP tool names.
   */
  getRegisteredTools(): string[] {
    return [...this.registeredTools];
  }

  /**
   * Check if a specific MCP server is connected.
   */
  isConnected(serverName: string): boolean {
    const client = this.clients.get(serverName);
    return client?.isConnected() ?? false;
  }

  // ============================================================
  // Private
  // ============================================================

  private wrapMcpTool(
    toolName: string,
    mcpTool: McpTool,
    client: McpStdioClient,
    serverName: string,
  ): Tool {
    return {
      name: toolName,
      description: `[MCP:${serverName}] ${mcpTool.description}`,
      parameters: {
        type: "object",
        description: `Parameters for MCP tool "${mcpTool.name}" on server "${serverName}"`,
        properties: mcpTool.inputSchema.properties,
        required: mcpTool.inputSchema.required,
      },
      handler: async (input: Record<string, unknown>): Promise<string> => {
        try {
          const result = await client.callTool(mcpTool.name, input);
          if (result.isError) {
            const errorText = result.content
              .filter((c): c is { type: "text"; text: string } => c.type === "text")
              .map((c) => c.text)
              .join("\n");
            throw new ToolError(
              JSON.stringify(input),
              `MCP tool error: ${errorText}`,
              "Check the tool input parameters and try again.",
            );
          }
          return result.content
            .filter((c): c is { type: "text"; text: string } => c.type === "text")
            .map((c) => c.text)
            .join("\n");
        } catch (err) {
          if (err instanceof ToolError) throw err;
          throw new ToolError(
            JSON.stringify(input),
            `MCP call failed: ${(err as Error).message}`,
            `Check if MCP server "${serverName}" is running and the tool "${mcpTool.name}" exists.`,
          );
        }
      },
    };
  }
}
