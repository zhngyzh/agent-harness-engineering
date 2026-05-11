/**
 * CLI Channel
 *
 * Simple stdin/stdout channel for terminal interaction.
 */

import { createInterface } from "node:readline";
import type { Channel, InboundMessage, OutboundMessage } from "./base.js";

export class CLIChannel implements Channel {
	name = "cli";
	private rl = createInterface({
		input: process.stdin,
		output: process.stdout,
	});
	private handler: ((msg: InboundMessage) => void) | null = null;
	private running = false;

	onMessage(handler: (msg: InboundMessage) => void): void {
		this.handler = handler;
	}

	async start(): Promise<void> {
		this.rl.on("line", (line) => {
			if (this.handler && line.trim()) {
				this.handler({
					id: `cli-${Date.now()}`,
					channel: "cli",
					accountId: "default",
					peerId: "user",
					text: line.trim(),
					timestamp: new Date().toISOString(),
					metadata: {},
				});
			}
		});
		this.rl.prompt();
		this.running = true;
	}

	async stop(): Promise<void> {
		this.running = false;
		this.rl.close();
	}

	async send(message: OutboundMessage): Promise<void> {
		process.stdout.write(`\n${message.text}\n`);
		if (this.running) this.rl.prompt();
	}
}
