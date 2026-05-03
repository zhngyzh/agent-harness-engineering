import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventBus, globalEvents } from "../../src/observability/events.js";
import { Logger, createLogger } from "../../src/observability/logger.js";
import type { AgentEvent } from "../../src/core/types.js";

// ============================================================
// EventBus
// ============================================================

describe("EventBus", () => {
  it("subscribes and emits events", () => {
    const bus = new EventBus();
    const received: AgentEvent[] = [];

    bus.on((event) => received.push(event));

    const event: AgentEvent = {
      type: "agent_start",
      sessionId: "s-test",
      timestamp: new Date().toISOString(),
      data: {},
    };
    bus.emit(event);

    expect(received.length).toBe(1);
    expect(received[0].type).toBe("agent_start");
  });

  it("notifies multiple subscribers", () => {
    const bus = new EventBus();
    let count = 0;

    bus.on(() => count++);
    bus.on(() => count++);
    bus.on(() => count++);

    bus.emit({
      type: "turn_start",
      sessionId: "s-test",
      timestamp: new Date().toISOString(),
      data: {},
    });

    expect(count).toBe(3);
  });

  it("unsubscribes via returned cleanup function", () => {
    const bus = new EventBus();
    let count = 0;

    const unsubscribe = bus.on(() => count++);

    bus.emit({
      type: "turn_start",
      sessionId: "s-test",
      timestamp: new Date().toISOString(),
      data: {},
    });
    expect(count).toBe(1);

    unsubscribe();

    bus.emit({
      type: "turn_start",
      sessionId: "s-test",
      timestamp: new Date().toISOString(),
      data: {},
    });
    expect(count).toBe(1); // Still 1 — unsubscribed
  });

  it("continues delivering to other handlers when one throws", () => {
    const bus = new EventBus();
    const received: AgentEvent[] = [];

    bus.on(() => { throw new Error("handler error"); });
    bus.on((event) => received.push(event));

    bus.emit({
      type: "error",
      sessionId: "s-test",
      timestamp: new Date().toISOString(),
      data: {},
    });

    expect(received.length).toBe(1);
  });

  it("emits to zero subscribers without error", () => {
    const bus = new EventBus();
    expect(() => {
      bus.emit({
        type: "agent_end",
        sessionId: "s-test",
        timestamp: new Date().toISOString(),
        data: {},
      });
    }).not.toThrow();
  });
});

describe("globalEvents", () => {
  it("is an EventBus instance", () => {
    expect(globalEvents).toBeInstanceOf(EventBus);
  });
});

// ============================================================
// Logger
// ============================================================

describe("Logger", () => {
  let logs: string[] = [];
  let originalLog: typeof console.log;
  let originalWarn: typeof console.warn;
  let originalError: typeof console.error;

  beforeEach(() => {
    logs = [];
    originalLog = console.log;
    originalWarn = console.warn;
    originalError = console.error;

    console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
    console.warn = (...args: unknown[]) => logs.push(args.map(String).join(" "));
    console.error = (...args: unknown[]) => logs.push(args.map(String).join(" "));
  });

  afterEach(() => {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  });

  it("logs info messages", () => {
    const logger = new Logger("test");
    logger.info("hello");

    expect(logs.length).toBe(1);
    expect(logs[0]).toContain("[INFO]");
    expect(logs[0]).toContain("[test]");
    expect(logs[0]).toContain("hello");
  });

  it("logs warn messages", () => {
    const logger = new Logger("test");
    logger.warn("warning");

    expect(logs.length).toBe(1);
    expect(logs[0]).toContain("[WARN]");
  });

  it("logs error messages", () => {
    const logger = new Logger("test");
    logger.error("failure");

    expect(logs.length).toBe(1);
    expect(logs[0]).toContain("[ERROR]");
  });

  it("respects minLevel — debug filtered at info level", () => {
    const logger = new Logger("test", "info");
    logger.debug("invisible");
    logger.info("visible");

    expect(logs.length).toBe(1);
    expect(logs[0]).toContain("visible");
  });

  it("includes data in log output", () => {
    const logger = new Logger("test");
    logger.info("event", { key: "value", num: 42 });

    expect(logs[0]).toContain('{"key":"value","num":42}');
  });

  it("includes timestamp and component in prefix", () => {
    const logger = new Logger("mycomp");
    logger.info("test");

    expect(logs[0]).toMatch(/\[\d{4}-\d{2}-\d{2}T/); // ISO timestamp
    expect(logs[0]).toContain("[mycomp]");
  });
});

describe("createLogger", () => {
  it("creates a Logger instance", () => {
    const logger = createLogger("component");
    expect(logger).toBeInstanceOf(Logger);
  });

  it("passes minLevel to Logger", () => {
    const logger = createLogger("component", "debug");
    expect(logger).toBeInstanceOf(Logger);
  });
});
