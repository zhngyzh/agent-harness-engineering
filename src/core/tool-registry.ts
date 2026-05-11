/**
 * Tool Registry & Dispatch
 *
 * ACI Design Principles (from knowledge base):
 * - Gen 1: API wrapping (avoid) — one tool per endpoint, too fine-grained
 * - Gen 2: ACI (current) — tools correspond to Agent goals, not API operations
 * - Gen 3: Advanced (future) — dynamic tool discovery + programmatic orchestration
 *
 * Each tool is self-contained: definition + handler.
 * Tools declare when NOT to use them (clear boundaries).
 * Errors include correction suggestions.
 */

import type { Tool, ToolDefinition } from "./types.js";

// ============================================================
// Built-in Tool Definitions
// ============================================================

export const bashTool: Tool = {
	name: "bash",
	description:
		"Execute a shell command in the workspace. " +
		"Use for file operations, running scripts, and system tasks. " +
		"NOT for reading files (use read_file), writing files (use write_file), or editing files (use edit_file). " +
		"Always use absolute paths. Working directory is the workspace root.",
	parameters: {
		type: "object",
		description: "Parameters for bash execution",
		properties: {
			command: {
				type: "string",
				description:
					"The shell command to execute. Must be a valid bash command.",
			},
			timeout_ms: {
				type: "number",
				description:
					"Timeout in milliseconds. Default 30000 (30s). Max 600000 (10min).",
			},
		},
		required: ["command"],
	},
	handler: async (input) => {
		const { execSync } = await import("node:child_process");
		const command = input.command as string;
		const timeout = (input.timeout_ms as number) || 30_000;
		try {
			const result = execSync(command, {
				timeout,
				maxBuffer: 1024 * 1024, // 1MB
				encoding: "utf-8",
			});
			return result.slice(0, 4000); // Truncate long outputs
		} catch (err) {
			const error = err as Error & { stderr?: string; status?: number };
			let msg = error.message;
			if (error.stderr) msg += `\nstderr: ${error.stderr}`;
			if (error.status !== undefined) msg += `\nexit code: ${error.status}`;
			throw new ToolError(
				command,
				msg,
				"Check the command syntax and file paths. Use 'ls' to verify file exists.",
			);
		}
	},
};

export const readFileTool: Tool = {
	name: "read_file",
	description:
		"Read the contents of a file. " +
		"Use when you need to examine existing file contents. " +
		"NOT for listing directories (use list_directory) or executing commands (use bash). " +
		"Returns file content with line numbers.",
	parameters: {
		type: "object",
		description: "Parameters for file reading",
		properties: {
			path: {
				type: "string",
				description: "Relative path to the file, e.g. 'src/index.ts'",
			},
			offset: {
				type: "number",
				description:
					"Line number to start reading from (1-indexed). Default: 1.",
			},
			limit: {
				type: "number",
				description: "Maximum number of lines to read. Default: 200.",
			},
		},
		required: ["path"],
	},
	handler: async (input) => {
		const fs = await import("node:fs");
		const path = await import("node:path");
		const filePath = input.path as string;
		const resolved = path.resolve(filePath);

		if (!fs.existsSync(resolved)) {
			throw new ToolError(
				filePath,
				`File not found: ${filePath}`,
				"Use list_directory to find the correct path.",
			);
		}

		const content = fs.readFileSync(resolved, "utf-8");
		const lines = content.split("\n");
		const offset = ((input.offset as number) || 1) - 1;
		const limit = (input.limit as number) || 200;
		const selected = lines.slice(offset, offset + limit);

		return selected
			.map((line, i) => `${String(offset + i + 1).padStart(6)}| ${line}`)
			.join("\n");
	},
};

export const writeFileTool: Tool = {
	name: "write_file",
	description:
		"Write content to a file. Creates the file if it doesn't exist, overwrites if it does. " +
		"Automatically creates parent directories. " +
		"NOT for editing existing files (use edit_file) or appending to files (use bash with >>).",
	parameters: {
		type: "object",
		description: "Parameters for file writing",
		properties: {
			path: {
				type: "string",
				description: "Relative path to the file, e.g. 'src/new-file.ts'",
			},
			content: {
				type: "string",
				description: "The full content to write to the file.",
			},
		},
		required: ["path", "content"],
	},
	handler: async (input) => {
		const fs = await import("node:fs");
		const path = await import("node:path");
		const filePath = input.path as string;
		const content = input.content as string;

		const dir = path.dirname(filePath);
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(filePath, content, "utf-8");

		const lines = content.split("\n").length;
		return `Written ${lines} lines to ${filePath}`;
	},
};

export const editFileTool: Tool = {
	name: "edit_file",
	description:
		"Edit a file by replacing exact text. " +
		"The oldText must match exactly (including whitespace). " +
		"Use this for precise, surgical edits. " +
		"NOT for creating new files (use write_file) or complete rewrites.",
	parameters: {
		type: "object",
		description: "Parameters for file editing",
		properties: {
			path: {
				type: "string",
				description: "Relative path to the file to edit.",
			},
			old_string: {
				type: "string",
				description: "Exact text to find and replace (must match exactly).",
			},
			new_string: {
				type: "string",
				description: "New text to replace the old text with.",
			},
		},
		required: ["path", "old_string", "new_string"],
	},
	handler: async (input) => {
		const fs = await import("node:fs");
		const path = await import("node:path");
		const filePath = input.path as string;
		const oldStr = input.old_string as string;
		const newStr = input.new_string as string;
		const resolved = path.resolve(filePath);

		if (!fs.existsSync(resolved)) {
			throw new ToolError(
				filePath,
				`File not found: ${filePath}`,
				"Use list_directory to find the correct path.",
			);
		}

		const content = fs.readFileSync(resolved, "utf-8");
		if (!content.includes(oldStr)) {
			throw new ToolError(
				filePath,
				`String not found in file: "${oldStr.slice(0, 50)}..."`,
				"Read the file first to find the exact text to replace.",
			);
		}

		const newContent = content.replace(oldStr, newStr);
		fs.writeFileSync(resolved, newContent, "utf-8");
		return `Edited ${filePath}: replaced ${oldStr.length} chars with ${newStr.length} chars`;
	},
};

export const listDirTool: Tool = {
	name: "list_directory",
	description:
		"List files and directories in a given path. " +
		"Use for exploring the workspace structure. " +
		"NOT for reading file contents (use read_file).",
	parameters: {
		type: "object",
		description: "Parameters for directory listing",
		properties: {
			path: {
				type: "string",
				description: "Relative path to the directory. Default: '.'",
			},
		},
		required: [],
	},
	handler: async (input) => {
		const fs = await import("node:fs");
		const dirPath = (input.path as string) || ".";

		const entries = fs.readdirSync(dirPath, { withFileTypes: true });
		const lines = entries.map((entry) => {
			const prefix = entry.isDirectory() ? "[DIR] " : "[FILE] ";
			return `${prefix}${entry.name}`;
		});

		return lines.join("\n") || "(empty directory)";
	},
};

// ============================================================
// Tool Registry
// ============================================================

export class ToolRegistry {
	private tools = new Map<string, Tool>();

	register(tool: Tool): this {
		this.tools.set(tool.name, tool);
		return this;
	}

	unregister(name: string): boolean {
		return this.tools.delete(name);
	}

	get(name: string): Tool | undefined {
		return this.tools.get(name);
	}

	has(name: string): boolean {
		return this.tools.has(name);
	}

	list(): Tool[] {
		return [...this.tools.values()];
	}

	/** Convert tools to LLM-compatible definitions */
	definitions(): ToolDefinition[] {
		return this.list().map((tool) => ({
			name: tool.name,
			description: tool.description,
			input_schema: tool.parameters as ToolDefinition["input_schema"],
		}));
	}

	/** Execute a tool by name with given input */
	async execute(name: string, input: Record<string, unknown>): Promise<string> {
		const tool = this.tools.get(name);
		if (!tool) {
			throw new Error(
				`Unknown tool: "${name}". Available tools: ${this.list()
					.map((t) => t.name)
					.join(", ")}`,
			);
		}
		return tool.handler(input);
	}
}

// ============================================================
// Default Registry (pre-loaded with built-in tools)
// ============================================================

export function createDefaultRegistry(): ToolRegistry {
	return new ToolRegistry()
		.register(bashTool)
		.register(readFileTool)
		.register(writeFileTool)
		.register(editFileTool)
		.register(listDirTool);
}

// ============================================================
// Tool Error (structured errors with correction suggestions)
// ============================================================

export class ToolError extends Error {
	constructor(
		public toolInput: string,
		message: string,
		public suggestion?: string,
	) {
		super(suggestion ? `${message}\nSuggestion: ${suggestion}` : message);
		this.name = "ToolError";
	}
}
