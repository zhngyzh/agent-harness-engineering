/**
 * Workspace Manager
 *
 * Manages the agent's workspace directory structure.
 * The workspace is the agent's "disk-based brain":
 *
 *   workspace/
 *     SOUL.md           - Personality
 *     IDENTITY.md       - Role definition
 *     TOOLS.md          - Tool documentation
 *     MEMORY.md         - Long-term memory
 *     AGENTS.md         - Multi-agent coordination
 *     HEARTBEAT.md      - Proactive behavior
 *     BOOTSTRAP.md      - Workspace documentation
 *     skills/           - Skill definitions
 *     .sessions/        - Session logs (auto-created)
 *     .traces/          - Execution traces (auto-created)
 *     memory/           - Daily memory logs (auto-created)
 *
 * Design: The workspace is self-documenting. BOOTSTRAP.md explains
 * the purpose of every file. AGENTS.md is kept short (~100 lines)
 * as an index; details go in subdirectories.
 */

import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { Logger } from "../observability/logger.js";

export interface WorkspaceFile {
	path: string;
	name: string;
	content: string;
	size: number;
	lastModified: string;
}

export interface WorkspaceInfo {
	path: string;
	files: WorkspaceFile[];
	skillCount: number;
	sessionCount: number;
	isInitialized: boolean;
}

export class WorkspaceManager {
	private log = new Logger("workspace");

	/** Files that should exist in an initialized workspace */
	static readonly CORE_FILES = [
		"SOUL.md",
		"IDENTITY.md",
		"TOOLS.md",
		"MEMORY.md",
		"AGENTS.md",
		"HEARTBEAT.md",
		"BOOTSTRAP.md",
	] as const;

	constructor(public readonly workspaceDir: string) {}

	/**
	 * Initialize the workspace with default files if not present.
	 * Only creates files that don't already exist (never overwrites).
	 */
	initialize(): void {
		mkdirSync(this.workspaceDir, { recursive: true });

		// Create subdirectories
		const dirs = ["skills", ".sessions", ".traces", "memory"];
		for (const dir of dirs) {
			mkdirSync(join(this.workspaceDir, dir), { recursive: true });
		}

		this.log.info(`Workspace initialized: ${this.workspaceDir}`);
	}

	/**
	 * Check if the workspace has been initialized (has at least SOUL.md).
	 */
	isInitialized(): boolean {
		return existsSync(join(this.workspaceDir, "SOUL.md"));
	}

	/**
	 * Get info about the workspace.
	 */
	getInfo(): WorkspaceInfo {
		const files = this.listFiles();
		const skillsDir = join(this.workspaceDir, "skills");
		const sessionsDir = join(this.workspaceDir, ".sessions");

		return {
			path: this.workspaceDir,
			files,
			skillCount: existsSync(skillsDir)
				? readdirSync(skillsDir, { withFileTypes: true }).filter((e) =>
						e.isDirectory(),
					).length
				: 0,
			sessionCount: existsSync(sessionsDir)
				? readdirSync(sessionsDir).filter((f) => f.endsWith(".jsonl")).length
				: 0,
			isInitialized: this.isInitialized(),
		};
	}

	/**
	 * List all workspace files (excluding auto-generated directories).
	 */
	listFiles(): WorkspaceFile[] {
		if (!existsSync(this.workspaceDir)) return [];

		const excludeDirs = new Set([".sessions", ".traces", "memory", ".git"]);
		const files: WorkspaceFile[] = [];

		const scan = (dir: string) => {
			const entries = readdirSync(dir, { withFileTypes: true });
			for (const entry of entries) {
				if (excludeDirs.has(entry.name)) continue;

				const fullPath = join(dir, entry.name);
				if (entry.isDirectory()) {
					scan(fullPath);
				} else if (
					entry.name.endsWith(".md") ||
					entry.name.endsWith(".json") ||
					entry.name.endsWith(".yaml")
				) {
					const st = statSync(fullPath);
					files.push({
						path: fullPath,
						name: entry.name,
						content: readFileSync(fullPath, "utf-8"),
						size: st.size,
						lastModified: st.mtime.toISOString(),
					});
				}
			}
		};

		scan(this.workspaceDir);
		return files;
	}

	/**
	 * Read a workspace file by name.
	 */
	readFile(fileName: string): string | null {
		const filePath = join(this.workspaceDir, fileName);
		if (!existsSync(filePath)) return null;
		return readFileSync(filePath, "utf-8");
	}

	/**
	 * Write a workspace file.
	 */
	writeFile(fileName: string, content: string): void {
		const filePath = join(this.workspaceDir, fileName);
		writeFileSync(filePath, content, "utf-8");
		this.log.info(`Workspace file written: ${fileName}`);
	}

	/**
	 * Get the path to a skill directory.
	 */
	skillDir(skillName: string): string {
		return join(this.workspaceDir, "skills", skillName);
	}

	/**
	 * Ensure a skill directory exists.
	 */
	ensureSkillDir(skillName: string): string {
		const dir = this.skillDir(skillName);
		mkdirSync(dir, { recursive: true });
		return dir;
	}
}
