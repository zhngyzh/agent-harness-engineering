/**
 * Agent Team + JSONL Mailbox
 *
 * Multiple named agents communicate via JSONL mailbox files.
 * Each agent has an inbox/ directory where other agents can drop messages.
 *
 * Message types:
 *   - message:      Standard point-to-point message
 *   - broadcast:    Sent to all team members
 *   - shutdown_request: Graceful shutdown handshake
 *   - shutdown_response: Acknowledgment
 *   - plan_approval_response: Plan gate response
 *
 * Design (from learn-claude-code s09-s10):
 *   - Persistent named agents (survive across turns)
 *   - JSONL inbox per agent (append-on-write, atomic)
 *   - request_id correlation for shutdown handshake
 *   - Plan approval FSM (submit -> approve/reject)
 */

import { randomUUID } from "node:crypto";
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { Logger } from "../observability/logger.js";

export type MessageType =
	| "message"
	| "broadcast"
	| "shutdown_request"
	| "shutdown_response"
	| "plan_approval_response";

export interface TeamMessage {
	id: string;
	type: MessageType;
	from: string;
	to: string; // agent name or "broadcast"
	content: string;
	request_id?: string;
	timestamp: string;
	read: boolean;
}

export interface TeamMember {
	name: string;
	role: string;
	inboxPath: string;
}

export class TeamMailbox {
	private teamDir: string;
	private log = new Logger("team");

	constructor(workspaceDir: string) {
		this.teamDir = join(workspaceDir, ".team");
	}

	/** Initialize the team directory */
	init(): void {
		mkdirSync(this.teamDir, { recursive: true });
		mkdirSync(join(this.teamDir, "inbox"), { recursive: true });
		this.log.info("Team mailbox initialized");
	}

	/** Register a team member (creates their inbox) */
	registerMember(name: string, role: string): TeamMember {
		const inboxPath = join(this.teamDir, "inbox", name);
		mkdirSync(inboxPath, { recursive: true });

		const member: TeamMember = { name, role, inboxPath };
		this.log.info(`Team member registered: ${name} (${role})`);
		return member;
	}

	/** Send a message to an agent's inbox */
	send(message: Omit<TeamMessage, "id" | "timestamp" | "read">): string {
		const id = randomUUID().slice(0, 8);
		const fullMessage: TeamMessage = {
			...message,
			id,
			timestamp: new Date().toISOString(),
			read: false,
		};

		if (message.to === "broadcast") {
			// Send to all members except sender
			const members = this.listMembers();
			for (const member of members) {
				if (member.name !== message.from) {
					this.writeToInbox(member.name, fullMessage);
				}
			}
		} else {
			this.writeToInbox(message.to, fullMessage);
		}

		this.log.debug(
			`Message sent: ${message.from} -> ${message.to} (${message.type})`,
		);
		return id;
	}

	/** Read unread messages from an inbox */
	readInbox(agentName: string, markRead = true): TeamMessage[] {
		const inboxPath = join(this.teamDir, "inbox", agentName);
		if (!existsSync(inboxPath)) return [];

		const messages: TeamMessage[] = [];
		const files = readdirSync(inboxPath).filter((f) => f.endsWith(".jsonl"));

		for (const file of files) {
			const filePath = join(inboxPath, file);
			const content = readFileSync(filePath, "utf-8");
			const lines = content.split("\n").filter((l) => l.trim());

			const unreadLines: string[] = [];
			for (const line of lines) {
				try {
					const msg: TeamMessage = JSON.parse(line);
					if (!msg.read) {
						messages.push(msg);
						if (markRead) {
							msg.read = true;
						}
					}
					unreadLines.push(JSON.stringify(msg));
				} catch {
					unreadLines.push(line);
				}
			}

			// Rewrite with updated read status
			if (markRead) {
				writeFileSync(filePath, `${unreadLines.join("\n")}\n`, "utf-8");
			}
		}

		return messages;
	}

	/** Count unread messages in an inbox */
	countUnread(agentName: string): number {
		return this.readInbox(agentName, false).length;
	}

	/** List all team members */
	listMembers(): TeamMember[] {
		const inboxDir = join(this.teamDir, "inbox");
		if (!existsSync(inboxDir)) return [];

		return readdirSync(inboxDir, { withFileTypes: true })
			.filter((e) => e.isDirectory())
			.map((e) => ({
				name: e.name,
				role: "agent",
				inboxPath: join(inboxDir, e.name),
			}));
	}

	/** Get team stats */
	getStats(): {
		members: number;
		totalMessages: number;
		unreadMessages: number;
	} {
		const members = this.listMembers();
		let totalMessages = 0;
		let unreadMessages = 0;

		for (const member of members) {
			const inboxPath = join(this.teamDir, "inbox", member.name);
			if (!existsSync(inboxPath)) continue;

			const files = readdirSync(inboxPath).filter((f) => f.endsWith(".jsonl"));
			for (const file of files) {
				const content = readFileSync(join(inboxPath, file), "utf-8");
				const lines = content.split("\n").filter((l) => l.trim());
				for (const line of lines) {
					try {
						const msg: TeamMessage = JSON.parse(line);
						totalMessages++;
						if (!msg.read) unreadMessages++;
					} catch {
						// skip
					}
				}
			}
		}

		return { members: members.length, totalMessages, unreadMessages };
	}

	/** Write a message to an agent's inbox */
	private writeToInbox(agentName: string, message: TeamMessage): void {
		const inboxPath = join(this.teamDir, "inbox", agentName);
		mkdirSync(inboxPath, { recursive: true });
		const filePath = join(inboxPath, "messages.jsonl");
		appendFileSync(filePath, `${JSON.stringify(message)}\n`, "utf-8");
	}
}
