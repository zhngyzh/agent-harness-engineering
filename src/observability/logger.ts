/**
 * Structured Logger
 *
 * Simple structured logging with levels and context.
 * Production would use pino/winston; this keeps zero extra deps.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
	level: LogLevel;
	timestamp: string;
	component: string;
	message: string;
	data?: Record<string, unknown>;
}

export class Logger {
	constructor(
		private component: string,
		private minLevel: LogLevel = "info",
	) {}

	private shouldLog(level: LogLevel): boolean {
		const levels: LogLevel[] = ["debug", "info", "warn", "error"];
		return levels.indexOf(level) >= levels.indexOf(this.minLevel);
	}

	private log(
		level: LogLevel,
		message: string,
		data?: Record<string, unknown>,
	): void {
		if (!this.shouldLog(level)) return;

		const entry: LogEntry = {
			level,
			timestamp: new Date().toISOString(),
			component: this.component,
			message,
			data,
		};

		const prefix = `[${entry.timestamp}] [${level.toUpperCase()}] [${this.component}]`;
		const dataStr = data ? ` ${JSON.stringify(data)}` : "";

		switch (level) {
			case "error":
				console.error(`${prefix} ${message}${dataStr}`);
				break;
			case "warn":
				console.warn(`${prefix} ${message}${dataStr}`);
				break;
			default:
				console.log(`${prefix} ${message}${dataStr}`);
		}
	}

	debug(message: string, data?: Record<string, unknown>): void {
		this.log("debug", message, data);
	}

	info(message: string, data?: Record<string, unknown>): void {
		this.log("info", message, data);
	}

	warn(message: string, data?: Record<string, unknown>): void {
		this.log("warn", message, data);
	}

	error(message: string, data?: Record<string, unknown>): void {
		this.log("error", message, data);
	}
}

/** Create a logger for a component */
export function createLogger(component: string, minLevel?: LogLevel): Logger {
	return new Logger(component, minLevel);
}
