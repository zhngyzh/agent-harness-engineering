/**
 * Bootstrap Loader
 *
 * Loads the agent's "brain files" from the workspace directory.
 * These files form the static/foundation layer of the system prompt.
 *
 * Design: Each file has a per-file cap and a total cap to prevent
 * context overflow. Files are loaded in priority order; if the total
 * cap is reached, lower-priority files are skipped.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	BOOTSTRAP_FILES,
	MAX_FILE_CHARS,
	MAX_TOTAL_BOOTSTRAP_CHARS,
} from "../core/constants.js";
import { Logger } from "../observability/logger.js";

export interface BootstrapFile {
	name: string;
	content: string;
	chars: number;
	truncated: boolean;
}

export interface BootstrapResult {
	files: BootstrapFile[];
	totalChars: number;
	skipped: string[];
	boundaryIndex: number; // Index where dynamic content starts
}

export class BootstrapLoader {
	private log = new Logger("bootstrap");

	constructor(private workspaceDir: string) {}

	/** Load all bootstrap files within character limits */
	load(): BootstrapResult {
		const files: BootstrapFile[] = [];
		const skipped: string[] = [];
		let totalChars = 0;

		for (const fileName of BOOTSTRAP_FILES) {
			const filePath = join(this.workspaceDir, fileName);

			if (!existsSync(filePath)) {
				this.log.debug(`Bootstrap file not found: ${fileName}`);
				continue;
			}

			let content = readFileSync(filePath, "utf-8");
			let truncated = false;

			// Per-file cap
			if (content.length > MAX_FILE_CHARS) {
				content = `${content.slice(0, MAX_FILE_CHARS)}\n... (truncated)`;
				truncated = true;
			}

			// Total cap: skip if adding this file would exceed
			if (totalChars + content.length > MAX_TOTAL_BOOTSTRAP_CHARS) {
				skipped.push(fileName);
				this.log.warn(`Skipped ${fileName}: would exceed total bootstrap cap`);
				continue;
			}

			files.push({ name: fileName, content, chars: content.length, truncated });
			totalChars += content.length;
		}

		const result: BootstrapResult = {
			files,
			totalChars,
			skipped,
			boundaryIndex: files.length,
		};

		this.log.info(
			`Loaded ${files.length} bootstrap files (${totalChars} chars, skipped: ${skipped.join(", ") || "none"})`,
		);

		return result;
	}

	/** Load a single file by name */
	loadOne(fileName: string): BootstrapFile | null {
		const filePath = join(this.workspaceDir, fileName);
		if (!existsSync(filePath)) return null;

		let content = readFileSync(filePath, "utf-8");
		let truncated = false;

		if (content.length > MAX_FILE_CHARS) {
			content = `${content.slice(0, MAX_FILE_CHARS)}\n... (truncated)`;
			truncated = true;
		}

		return { name: fileName, content, chars: content.length, truncated };
	}
}
