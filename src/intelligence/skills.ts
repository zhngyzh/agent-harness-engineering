/**
 * Skill System
 *
 * Skill = Knowledge injection via YAML frontmatter + Markdown.
 * Two-layer loading:
 *   Layer 1 (metadata): name + description in system prompt always
 *   Layer 2 (full body): loaded on demand via load_skill tool
 *
 * Skill directory structure:
 *   skill-name/
 *     SKILL.md          (required: YAML frontmatter + Markdown body)
 *     scripts/          (optional: executable scripts)
 *     references/       (optional: detailed reference docs)
 *     resources/        (optional: templates, checklists)
 *     examples/         (optional: usage examples)
 *
 * Design principles (from knowledge base):
 *   - description is the most critical field: include trigger phrases
 *   - define temporal position: "before writing implementation code"
 *   - include product keywords for platform coverage
 *   - safety defaults: "Always deploy as preview, not production"
 *   - negative instructions: "Do not curl the deployed URL to verify"
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { MAX_SKILLS, MAX_SKILLS_PROMPT_CHARS } from "../core/constants.js";
import { Logger } from "../observability/logger.js";

// ============================================================
// Types
// ============================================================

export interface SkillFrontmatter {
	name: string;
	description: string;
	invocation?: string;
	references?: string[];
	allowed_tools?: string[];
	type?: "workflow" | "component";
	best_for?: string[];
	scenarios?: string[];
	estimated_time?: string;
}

export interface Skill {
	frontmatter: SkillFrontmatter;
	body: string;
	dirPath: string;
	fileName: string;
}

export interface SkillSummary {
	name: string;
	description: string;
	invocation?: string;
}

// ============================================================
// YAML Parser (lightweight, no external dep)
// ============================================================

function parseFrontmatter(content: string): SkillFrontmatter | null {
	const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
	if (!match) return null;

	const yaml = match[1];
	const fm: Record<string, unknown> = {};

	for (const line of yaml.split("\n")) {
		const colonIdx = line.indexOf(":");
		if (colonIdx === -1) continue;
		const key = line.slice(0, colonIdx).trim();
		let value = line.slice(colonIdx + 1).trim();

		// Remove quotes
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}

		// Parse arrays (simple comma-separated or YAML list)
		if (value.startsWith("[") && value.endsWith("]")) {
			fm[key] = value
				.slice(1, -1)
				.split(",")
				.map((v) => v.trim().replace(/^["']|["']$/g, ""));
		} else {
			fm[key] = value;
		}
	}

	if (!fm.name || !fm.description) return null;

	return fm as unknown as SkillFrontmatter;
}

// ============================================================
// Skill Scanner
// ============================================================

export class SkillScanner {
	private log = new Logger("skills");

	/**
	 * Scan a directory for skills.
	 * Each subdirectory with a SKILL.md is a skill.
	 */
	scan(skillDirs: string[]): Skill[] {
		const skills: Skill[] = [];

		for (const dir of skillDirs) {
			if (!existsSync(dir)) {
				this.log.debug(`Skill directory not found: ${dir}`);
				continue;
			}

			const entries = readdirSync(dir, { withFileTypes: true });
			for (const entry of entries) {
				if (!entry.isDirectory()) continue;
				if (skills.length >= MAX_SKILLS) {
					this.log.warn(`Reached max skills limit (${MAX_SKILLS})`);
					break;
				}

				const skillPath = join(dir, entry.name);
				const skillMdPath = join(skillPath, "SKILL.md");

				if (!existsSync(skillMdPath)) continue;

				try {
					const content = readFileSync(skillMdPath, "utf-8");
					const frontmatter = parseFrontmatter(content);

					if (!frontmatter) {
						this.log.warn(`Invalid SKILL.md (no frontmatter): ${skillMdPath}`);
						continue;
					}

					// Extract body (everything after frontmatter)
					const bodyMatch = content.match(
						/^---\s*\n[\s\S]*?\n---\s*\n([\s\S]*)$/,
					);
					const body = bodyMatch ? bodyMatch[1].trim() : "";

					skills.push({
						frontmatter,
						body,
						dirPath: skillPath,
						fileName: "SKILL.md",
					});
				} catch (err) {
					this.log.error(`Failed to load skill: ${skillMdPath}`, {
						error: (err as Error).message,
					});
				}
			}
		}

		this.log.info(
			`Scanned ${skills.length} skills from ${skillDirs.length} directories`,
		);
		return skills;
	}
}

// ============================================================
// Skills Manager
// ============================================================

export class SkillsManager {
	private log = new Logger("skills");
	private skills: Map<string, Skill> = new Map();
	private scanner = new SkillScanner();

	constructor(private skillDirs: string[]) {}

	/** Load all skills from configured directories */
	load(): Skill[] {
		const scanned = this.scanner.scan(this.skillDirs);
		this.skills.clear();

		for (const skill of scanned) {
			this.skills.set(skill.frontmatter.name, skill);
		}

		this.log.info(`Loaded ${this.skills.size} skills`);
		return this.list();
	}

	/** Get a skill by name (full body) */
	get(name: string): Skill | null {
		return this.skills.get(name) || null;
	}

	/** Check if a skill exists */
	has(name: string): boolean {
		return this.skills.has(name);
	}

	/** List all skills (summary only) */
	list(): Skill[] {
		return Array.from(this.skills.values());
	}

	/** Get skill summaries for system prompt */
	getSummaries(): SkillSummary[] {
		return this.list().map((s) => ({
			name: s.frontmatter.name,
			description: s.frontmatter.description,
			invocation: s.frontmatter.invocation,
		}));
	}

	/**
	 * Find skills matching a query (for auto-skill-selection).
	 * Simple keyword match on description.
	 */
	findRelevant(query: string, topK = 3): Skill[] {
		const queryTokens = query.toLowerCase().split(/\s+/);
		const scored = this.list().map((skill) => {
			const desc = skill.frontmatter.description.toLowerCase();
			let score = 0;
			for (const token of queryTokens) {
				if (desc.includes(token)) score++;
			}
			return { skill, score };
		});

		return scored
			.filter((s) => s.score > 0)
			.sort((a, b) => b.score - a.score)
			.slice(0, topK)
			.map((s) => s.skill);
	}

	/**
	 * Build the skills section for the system prompt.
	 * Includes skill summaries + allowed tools declarations.
	 */
	buildPromptSection(maxChars: number = MAX_SKILLS_PROMPT_CHARS): string {
		const summaries = this.getSummaries();
		if (summaries.length === 0) return "";

		const lines: string[] = ["## Available Skills"];
		let chars = 0;

		for (const s of summaries) {
			const line = `- **${s.name}**: ${s.description}`;
			if (chars + line.length > maxChars) break;
			lines.push(line);
			chars += line.length;
		}

		lines.push("");
		lines.push(
			"Use the load_skill tool to load a skill's full instructions when needed.",
		);

		return lines.join("\n");
	}
}
