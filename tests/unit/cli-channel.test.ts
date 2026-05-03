import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CLIChannel } from "../../src/channels/cli.js";
import type { Channel, InboundMessage } from "../../src/channels/base.js";

describe("CLIChannel", () => {
  it("implements the Channel interface", () => {
    const channel = new CLIChannel();
    expect(channel).toHaveProperty("name");
    expect(channel).toHaveProperty("start");
    expect(channel).toHaveProperty("stop");
    expect(channel).toHaveProperty("send");
    expect(channel).toHaveProperty("onMessage");
    expect(typeof channel.name).toBe("string");
    expect(typeof channel.start).toBe("function");
    expect(typeof channel.stop).toBe("function");
    expect(typeof channel.send).toBe("function");
    expect(typeof channel.onMessage).toBe("function");
  });

  it('has name "cli"', () => {
    const channel = new CLIChannel();
    expect(channel.name).toBe("cli");
  });

  it("registers message handler via onMessage", () => {
    const channel = new CLIChannel();
    let called = false;
    channel.onMessage(() => { called = true; });
    // Handler is registered — we can't easily trigger stdin in unit tests,
    // but we verify the registration doesn't throw
    expect(called).toBe(false);
  });

  it("stop closes without error", async () => {
    const channel = new CLIChannel();
    await expect(channel.stop()).resolves.not.toThrow();
  });

  it("send writes to stdout without error", async () => {
    const channel = new CLIChannel();
    await expect(channel.send({
      targetPeerId: "user",
      text: "Hello from test",
    })).resolves.not.toThrow();
  });
});
