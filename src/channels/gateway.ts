/**
 * WebSocket Gateway + 5-Tier Routing
 *
 * Gateway accepts WebSocket connections and routes messages to agents.
 * Routing priority (highest first):
 *   Tier 1: peer_id       (specific user)
 *   Tier 2: guild_id      (specific group/server)
 *   Tier 3: account_id    (specific bot account)
 *   Tier 4: channel       (any account on this channel)
 *   Tier 5: default       (fallback agent)
 *
 * Session key format:
 *   dm_scope: main | per-peer | per-channel-peer | per-account-channel-peer
 */

import { WebSocket, WebSocketServer } from "ws";
import type { AgentConfig } from "../core/types.js";
import { Logger } from "../observability/logger.js";
import type { Channel, InboundMessage, OutboundMessage } from "./base.js";

export interface Binding {
	tier: 1 | 2 | 3 | 4 | 5;
	agentName: string;
	peerId?: string;
	guildId?: string;
	accountId?: string;
	channel?: string;
}

export interface AgentRegistration {
	name: string;
	config: AgentConfig;
}

export type DMSCOPE =
	| "main"
	| "per-peer"
	| "per-channel-peer"
	| "per-account-channel-peer";

export class Gateway implements Channel {
	name = "websocket";
	private wss: WebSocketServer | null = null;
	private clients = new Map<string, WebSocket>();
	private bindings: Binding[] = [];
	private agents = new Map<string, AgentRegistration>();
	private handler: ((msg: InboundMessage) => void) | null = null;
	private log = new Logger("gateway");

	constructor(
		private host = "127.0.0.1",
		private port = 8787,
		private dmScope: DMSCOPE = "per-peer",
	) {}

	onMessage(handler: (msg: InboundMessage) => void): void {
		this.handler = handler;
	}

	/** Register an agent */
	registerAgent(registration: AgentRegistration): void {
		this.agents.set(registration.name, registration);
		this.log.info(`Agent registered: ${registration.name}`);
	}

	/** Add a routing binding */
	addBinding(binding: Binding): void {
		this.bindings.push(binding);
		// Keep sorted by tier (lower number = higher priority)
		this.bindings.sort((a, b) => a.tier - b.tier);
	}

	/** Resolve which agent should handle a message */
	resolveAgent(msg: InboundMessage): string | null {
		for (const binding of this.bindings) {
			if (binding.tier === 1 && binding.peerId === msg.peerId)
				return binding.agentName;
			if (binding.tier === 2 && binding.guildId === msg.guildId)
				return binding.agentName;
			if (binding.tier === 3 && binding.accountId === msg.accountId)
				return binding.agentName;
			if (binding.tier === 4 && binding.channel === msg.channel)
				return binding.agentName;
			if (binding.tier === 5) return binding.agentName;
		}
		return null;
	}

	/** Build session key based on dm_scope */
	buildSessionKey(msg: InboundMessage): string {
		switch (this.dmScope) {
			case "main":
				return "main";
			case "per-peer":
				return `peer:${msg.peerId}`;
			case "per-channel-peer":
				return `${msg.channel}:${msg.peerId}`;
			case "per-account-channel-peer":
				return `${msg.accountId}:${msg.channel}:${msg.peerId}`;
		}
	}

	async start(): Promise<void> {
		this.wss = new WebSocketServer({ host: this.host, port: this.port });

		this.wss.on("connection", (ws) => {
			const clientId = `ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
			this.clients.set(clientId, ws);
			this.log.info(`Client connected: ${clientId}`);

			ws.on("message", (data) => {
				try {
					const parsed = JSON.parse(data.toString());
					if (this.handler) {
						const msg: InboundMessage = {
							id: parsed.id || `msg-${Date.now()}`,
							channel: "websocket",
							accountId: parsed.accountId || "default",
							peerId: parsed.peerId || clientId,
							guildId: parsed.guildId,
							text: parsed.text || "",
							timestamp: new Date().toISOString(),
							metadata: { clientId, ...parsed.metadata },
						};
						this.handler(msg);
					}
				} catch (err) {
					this.log.error("Failed to parse message", {
						error: (err as Error).message,
					});
				}
			});

			ws.on("close", () => {
				this.clients.delete(clientId);
				this.log.info(`Client disconnected: ${clientId}`);
			});
		});

		this.log.info(`Gateway listening on ws://${this.host}:${this.port}`);
	}

	async stop(): Promise<void> {
		for (const ws of this.clients.values()) {
			ws.close();
		}
		this.clients.clear();
		this.wss?.close();
	}

	async send(message: OutboundMessage): Promise<void> {
		const payload = JSON.stringify({
			type: "message",
			text: message.text,
			replyTo: message.replyToId,
			timestamp: new Date().toISOString(),
		});

		// Send to specific peer
		for (const [, ws] of this.clients) {
			if (ws.readyState === WebSocket.OPEN) {
				ws.send(payload);
			}
		}
	}
}
