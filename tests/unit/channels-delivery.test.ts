import {
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { InboundMessage } from "../../src/channels/base.js";
import { Gateway } from "../../src/channels/gateway.js";
import { MockLLMClient } from "../../src/core/anthropic-client.js";
import { DeliveryQueue } from "../../src/delivery/queue.js";
import {
	FailoverReason,
	ProfileManager,
	ResilienceError,
	ResilienceRunner,
} from "../../src/delivery/resilience.js";
import type { AuthProfile } from "../../src/delivery/resilience.js";

const TEST_DIR = join(import.meta.dirname, "..", "..", ".test-channels");

describe("Gateway - 5-Tier Routing", () => {
	it("resolves tier 1 (peer_id) binding", () => {
		const gw = new Gateway("127.0.0.1", 0);
		gw.addBinding({ tier: 5, agentName: "default" });
		gw.addBinding({ tier: 1, agentName: "special", peerId: "user-123" });

		const msg: InboundMessage = {
			id: "1",
			channel: "ws",
			accountId: "a1",
			peerId: "user-123",
			text: "hi",
			timestamp: "",
			metadata: {},
		};

		expect(gw.resolveAgent(msg)).toBe("special");
	});

	it("resolves tier 2 (guild_id) binding", () => {
		const gw = new Gateway("127.0.0.1", 0);
		gw.addBinding({ tier: 5, agentName: "default" });
		gw.addBinding({ tier: 2, agentName: "guild-agent", guildId: "guild-456" });

		const msg: InboundMessage = {
			id: "1",
			channel: "ws",
			accountId: "a1",
			peerId: "user-1",
			guildId: "guild-456",
			text: "hi",
			timestamp: "",
			metadata: {},
		};

		expect(gw.resolveAgent(msg)).toBe("guild-agent");
	});

	it("falls back to default when no binding matches", () => {
		const gw = new Gateway("127.0.0.1", 0);
		gw.addBinding({ tier: 5, agentName: "default" });

		const msg: InboundMessage = {
			id: "1",
			channel: "ws",
			accountId: "a1",
			peerId: "unknown",
			text: "hi",
			timestamp: "",
			metadata: {},
		};

		expect(gw.resolveAgent(msg)).toBe("default");
	});

	it("returns null when no bindings exist", () => {
		const gw = new Gateway("127.0.0.1", 0);
		const msg: InboundMessage = {
			id: "1",
			channel: "ws",
			accountId: "a1",
			peerId: "user",
			text: "hi",
			timestamp: "",
			metadata: {},
		};

		expect(gw.resolveAgent(msg)).toBeNull();
	});

	it("builds session key with per-peer scope", () => {
		const gw = new Gateway("127.0.0.1", 0, "per-peer");
		const msg: InboundMessage = {
			id: "1",
			channel: "ws",
			accountId: "a1",
			peerId: "user-123",
			text: "hi",
			timestamp: "",
			metadata: {},
		};

		expect(gw.buildSessionKey(msg)).toBe("peer:user-123");
	});

	it("builds session key with per-account-channel-peer scope", () => {
		const gw = new Gateway("127.0.0.1", 0, "per-account-channel-peer");
		const msg: InboundMessage = {
			id: "1",
			channel: "telegram",
			accountId: "bot-1",
			peerId: "user-123",
			text: "hi",
			timestamp: "",
			metadata: {},
		};

		expect(gw.buildSessionKey(msg)).toBe("bot-1:telegram:user-123");
	});
});

describe("DeliveryQueue", () => {
	let queueDir: string;

	beforeEach(() => {
		queueDir = join(TEST_DIR, `queue-${Date.now()}`);
		mkdirSync(queueDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(TEST_DIR, { recursive: true, force: true });
	});

	it("enqueues and retrieves pending messages", () => {
		const queue = new DeliveryQueue(queueDir);
		queue.enqueue({ targetPeerId: "user-1", text: "Hello!" });

		const pending = queue.getPending();
		expect(pending.length).toBe(1);
		expect(pending[0].message.text).toBe("Hello!");
	});

	it("marks messages as delivered", () => {
		const queue = new DeliveryQueue(queueDir);
		const id = queue.enqueue({ targetPeerId: "user-1", text: "Test" });

		queue.markDelivered(id);
		const pending = queue.getPending();
		expect(pending.length).toBe(0);
	});

	it("schedules retry on failure", () => {
		const queue = new DeliveryQueue(queueDir);
		const id = queue.enqueue({ targetPeerId: "user-1", text: "Test" });

		queue.markFailed(id, "timeout");

		const stats = queue.getStats();
		expect(stats.pending).toBe(1); // Still pending, scheduled for retry
	});

	it("moves to failed after max retries", () => {
		const queue = new DeliveryQueue(queueDir);
		const id = queue.enqueue({ targetPeerId: "user-1", text: "Test" });

		// Fail 5 times (max retries)
		for (let i = 0; i < 5; i++) {
			queue.markFailed(id, "timeout");
		}

		const stats = queue.getStats();
		expect(stats.failed).toBeGreaterThan(0);
	});

	it("reports queue stats", () => {
		const queue = new DeliveryQueue(queueDir);
		queue.enqueue({ targetPeerId: "user-1", text: "Msg 1" });
		queue.enqueue({ targetPeerId: "user-2", text: "Msg 2" });

		const stats = queue.getStats();
		expect(stats.total).toBe(2);
		expect(stats.pending).toBe(2);
	});
});

describe("Resilience - ProfileManager", () => {
	const profiles: AuthProfile[] = [
		{ apiKey: "key-1", label: "primary", cooldownUntil: null, failureCount: 0 },
		{
			apiKey: "key-2",
			label: "secondary",
			cooldownUntil: null,
			failureCount: 0,
		},
		{
			apiKey: "key-3",
			label: "tertiary",
			cooldownUntil: null,
			failureCount: 0,
		},
	];

	it("returns current profile", () => {
		const pm = new ProfileManager(profiles);
		expect(pm.current().label).toBe("primary");
	});

	it("rotates to next profile", () => {
		const pm = new ProfileManager(profiles);
		const next = pm.rotate(FailoverReason.AUTH_ERROR);
		expect(next?.label).toBe("secondary");
		expect(pm.current().label).toBe("secondary");
	});

	it("skips profiles in cooldown", () => {
		const pm = new ProfileManager([
			{
				apiKey: "key-1",
				label: "p1",
				cooldownUntil: new Date(Date.now() + 60000).toISOString(),
				failureCount: 0,
			},
			{
				apiKey: "key-2",
				label: "p2",
				cooldownUntil: new Date(Date.now() + 60000).toISOString(),
				failureCount: 0,
			},
			{ apiKey: "key-3", label: "p3", cooldownUntil: null, failureCount: 0 },
		]);

		const next = pm.rotate(FailoverReason.AUTH_ERROR);
		expect(next?.label).toBe("p3");
	});

	it("puts profile on cooldown", () => {
		const pm = new ProfileManager(profiles);
		pm.cooldownCurrent(30000);
		expect(pm.current().cooldownUntil).not.toBeNull();
	});
});

describe("Resilience - ResilienceRunner", () => {
	it("succeeds on first attempt", async () => {
		const profiles: AuthProfile[] = [
			{
				apiKey: "key-1",
				label: "primary",
				cooldownUntil: null,
				failureCount: 0,
			},
		];
		const pm = new ProfileManager(profiles);
		const mockClient = new MockLLMClient();

		const runner = new ResilienceRunner(pm, () => mockClient);

		const result = await runner.execute(
			[{ role: "user", content: [{ type: "text", text: "hi" }] }],
			"system",
			[],
			4096,
		);

		expect(result).toBeDefined();
	});

	it("rotates profile on auth error", async () => {
		const profiles: AuthProfile[] = [
			{ apiKey: "key-1", label: "p1", cooldownUntil: null, failureCount: 0 },
			{ apiKey: "key-2", label: "p2", cooldownUntil: null, failureCount: 0 },
		];
		const pm = new ProfileManager(profiles);

		let callCount = 0;
		const runner = new ResilienceRunner(pm, () => {
			callCount++;
			if (callCount === 1) {
				const client = new MockLLMClient();
				// Override messages to throw
				client.messages = async () => {
					throw new Error("401 Unauthorized");
				};
				return client;
			}
			return new MockLLMClient();
		});

		const result = await runner.execute(
			[{ role: "user", content: [{ type: "text", text: "hi" }] }],
			"system",
			[],
			4096,
		);

		expect(result).toBeDefined();
		expect(callCount).toBeGreaterThan(1);
	});

	it("throws ResilienceError when context overflow", async () => {
		const profiles: AuthProfile[] = [
			{ apiKey: "key-1", label: "p1", cooldownUntil: null, failureCount: 0 },
		];
		const pm = new ProfileManager(profiles);

		const runner = new ResilienceRunner(pm, () => {
			const client = new MockLLMClient();
			// Context overflow throws ResilienceError immediately (Layer 2)
			client.messages = async () => {
				throw new Error("context length exceeded max_tokens");
			};
			return client;
		});

		await expect(
			runner.execute(
				[{ role: "user", content: [{ type: "text", text: "hi" }] }],
				"system",
				[],
				4096,
			),
		).rejects.toThrow(ResilienceError);
	});
});
