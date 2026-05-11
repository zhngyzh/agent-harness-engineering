import { describe, expect, it } from "vitest";
import {
	ToolRegistry,
	bashTool,
	createDefaultRegistry,
	editFileTool,
	listDirTool,
	readFileTool,
	writeFileTool,
} from "../../src/core/tool-registry.js";

describe("ToolRegistry", () => {
	it("registers and retrieves tools", () => {
		const registry = new ToolRegistry();
		registry.register(bashTool);
		expect(registry.has("bash")).toBe(true);
		expect(registry.get("bash")).toBe(bashTool);
	});

	it("lists all registered tools", () => {
		const registry = createDefaultRegistry();
		const tools = registry.list();
		expect(tools.length).toBe(5);
		const names = tools.map((t) => t.name);
		expect(names).toContain("bash");
		expect(names).toContain("read_file");
		expect(names).toContain("write_file");
		expect(names).toContain("edit_file");
		expect(names).toContain("list_directory");
	});

	it("converts to LLM-compatible definitions", () => {
		const registry = createDefaultRegistry();
		const defs = registry.definitions();
		expect(defs.length).toBe(5);
		for (const def of defs) {
			expect(def).toHaveProperty("name");
			expect(def).toHaveProperty("description");
			expect(def).toHaveProperty("input_schema");
			expect(def.input_schema.type).toBe("object");
		}
	});

	it("throws on unknown tool execution", async () => {
		const registry = new ToolRegistry();
		await expect(registry.execute("nonexistent", {})).rejects.toThrow(
			"Unknown tool",
		);
	});

	it("executes bash tool", async () => {
		const registry = new ToolRegistry();
		registry.register(bashTool);
		const result = await registry.execute("bash", { command: "echo hello" });
		expect(result).toContain("hello");
	});

	it("unregisters tools", () => {
		const registry = new ToolRegistry();
		registry.register(bashTool);
		expect(registry.unregister("bash")).toBe(true);
		expect(registry.has("bash")).toBe(false);
	});
});
