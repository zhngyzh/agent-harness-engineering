import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TeamMailbox } from "../../src/collaboration/team.js";

const TEST_DIR = join(import.meta.dirname, "..", "..", ".test-team");

// ============================================================
// TeamMailbox
// ============================================================

describe("TeamMailbox", () => {
	let team: TeamMailbox;

	beforeEach(() => {
		rmSync(TEST_DIR, { recursive: true, force: true });
		mkdirSync(TEST_DIR, { recursive: true });
		team = new TeamMailbox(TEST_DIR);
		team.init();
	});

	afterEach(() => {
		rmSync(TEST_DIR, { recursive: true, force: true });
	});

	it("initializes team directory", () => {
		const inboxDir = join(TEST_DIR, ".team", "inbox");
		expect(team.listMembers()).toEqual([]);
	});

	it("registers team members", () => {
		const alice = team.registerMember("alice", "researcher");
		expect(alice.name).toBe("alice");
		expect(alice.role).toBe("researcher");
		expect(alice.inboxPath).toContain("alice");

		const members = team.listMembers();
		expect(members.length).toBe(1);
		expect(members[0].name).toBe("alice");
	});

	it("registers multiple members", () => {
		team.registerMember("alice", "researcher");
		team.registerMember("bob", "writer");
		team.registerMember("charlie", "reviewer");

		expect(team.listMembers().length).toBe(3);
	});

	it("sends a direct message", () => {
		team.registerMember("alice", "researcher");
		team.registerMember("bob", "writer");

		const msgId = team.send({
			type: "message",
			from: "alice",
			to: "bob",
			content: "Hello Bob!",
		});

		expect(msgId).toBeDefined();
		expect(msgId.length).toBe(8);

		const messages = team.readInbox("bob");
		expect(messages.length).toBe(1);
		expect(messages[0].from).toBe("alice");
		expect(messages[0].content).toBe("Hello Bob!");
		expect(messages[0].type).toBe("message");
	});

	it("marks messages as read", () => {
		team.registerMember("alice", "researcher");
		team.registerMember("bob", "writer");

		team.send({
			type: "message",
			from: "alice",
			to: "bob",
			content: "First message",
		});

		// First read marks as read
		team.readInbox("bob");
		// Second read returns nothing (already read)
		const secondRead = team.readInbox("bob");
		expect(secondRead.length).toBe(0);
	});

	it("readInbox with markRead=false does not mark messages", () => {
		team.registerMember("alice", "researcher");
		team.registerMember("bob", "writer");

		team.send({
			type: "message",
			from: "alice",
			to: "bob",
			content: "Test",
		});

		// Read without marking
		const firstRead = team.readInbox("bob", false);
		expect(firstRead.length).toBe(1);

		// Messages should still be unread
		const secondRead = team.readInbox("bob", false);
		expect(secondRead.length).toBe(1);
	});

	it("sends broadcast to all except sender", () => {
		team.registerMember("alice", "researcher");
		team.registerMember("bob", "writer");
		team.registerMember("charlie", "reviewer");

		team.send({
			type: "broadcast",
			from: "alice",
			to: "broadcast",
			content: "Hello everyone!",
		});

		// Bob and Charlie got it, Alice did not
		expect(team.readInbox("bob").length).toBe(1);
		expect(team.readInbox("charlie").length).toBe(1);
		expect(team.readInbox("alice").length).toBe(0);
	});

	it("countUnread returns correct count", () => {
		team.registerMember("alice", "researcher");
		team.registerMember("bob", "writer");

		team.send({ type: "message", from: "alice", to: "bob", content: "Msg 1" });
		team.send({ type: "message", from: "alice", to: "bob", content: "Msg 2" });
		team.send({ type: "message", from: "alice", to: "bob", content: "Msg 3" });

		expect(team.countUnread("bob")).toBe(3);

		team.readInbox("bob"); // marks all as read
		expect(team.countUnread("bob")).toBe(0);
	});

	it("getStats returns team statistics", () => {
		team.registerMember("alice", "researcher");
		team.registerMember("bob", "writer");

		team.send({ type: "message", from: "alice", to: "bob", content: "Hello" });
		team.send({ type: "message", from: "bob", to: "alice", content: "Hi" });

		const stats = team.getStats();
		expect(stats.members).toBe(2);
		expect(stats.totalMessages).toBe(2);
		expect(stats.unreadMessages).toBe(2);

		// Read one inbox
		team.readInbox("bob");
		const statsAfter = team.getStats();
		expect(statsAfter.unreadMessages).toBe(1);
	});

	it("getStats returns zeros for empty team", () => {
		const stats = team.getStats();
		expect(stats.members).toBe(0);
		expect(stats.totalMessages).toBe(0);
		expect(stats.unreadMessages).toBe(0);
	});

	it("readInbox returns empty for unknown agent", () => {
		const messages = team.readInbox("nonexistent");
		expect(messages).toEqual([]);
	});

	it("supports shutdown_request message type", () => {
		team.registerMember("alice", "researcher");
		team.registerMember("bob", "writer");

		team.send({
			type: "shutdown_request",
			from: "alice",
			to: "bob",
			content: "Please shut down",
			request_id: "shutdown-001",
		});

		const messages = team.readInbox("bob");
		expect(messages.length).toBe(1);
		expect(messages[0].type).toBe("shutdown_request");
		expect(messages[0].request_id).toBe("shutdown-001");
	});

	it("supports plan_approval_response message type", () => {
		team.registerMember("alice", "researcher");
		team.registerMember("bob", "writer");

		team.send({
			type: "plan_approval_response",
			from: "bob",
			to: "alice",
			content: "Plan approved",
			request_id: "plan-001",
		});

		const messages = team.readInbox("alice");
		expect(messages.length).toBe(1);
		expect(messages[0].type).toBe("plan_approval_response");
		expect(messages[0].content).toBe("Plan approved");
	});

	it("messages include id and timestamp", () => {
		team.registerMember("alice", "researcher");
		team.registerMember("bob", "writer");

		team.send({
			type: "message",
			from: "alice",
			to: "bob",
			content: "Test",
		});

		const messages = team.readInbox("bob");
		expect(messages[0].id).toBeDefined();
		expect(messages[0].id.length).toBe(8);
		expect(messages[0].timestamp).toBeDefined();
		expect(new Date(messages[0].timestamp).getTime()).not.toBeNaN();
	});
});
