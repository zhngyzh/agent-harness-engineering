import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SessionStore } from "../../src/core/session.js";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const TEST_DIR = join(import.meta.dirname, "..", "..", ".test-workspace");

describe("SessionStore", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("creates a new session with generated ID", () => {
    const session = new SessionStore(TEST_DIR);
    expect(session.sessionId).toMatch(/^s-/);
  });

  it("creates a session with custom ID", () => {
    const session = new SessionStore(TEST_DIR, "custom-id");
    expect(session.sessionId).toBe("custom-id");
  });

  it("appends and reads messages", async () => {
    const session = new SessionStore(TEST_DIR);
    const messages = [
      { role: "user" as const, content: [{ type: "text" as const, text: "hello" }] },
      { role: "assistant" as const, content: [{ type: "text" as const, text: "hi" }] },
    ];
    await session.appendMessages(messages);
    const read = session.readMessages();
    expect(read.length).toBe(2);
    expect(read[0].role).toBe("user");
    expect(read[1].role).toBe("assistant");
  });

  it("returns metadata", () => {
    const session = new SessionStore(TEST_DIR);
    const meta = session.getMeta();
    expect(meta).not.toBeNull();
    expect(meta?.id).toBe(session.sessionId);
    expect(meta?.status).toBe("active");
  });
});
