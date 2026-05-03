/**
 * Event Bus
 *
 * Architecture: publish once, multiple consumers.
 * The agent loop emits events; downstream consumers (tracing, UI, evaluation)
 * subscribe independently. The loop code never changes for downstream needs.
 */

import type { AgentEvent, EventHandler } from "../core/types.js";

export class EventBus {
  private handlers: EventHandler[] = [];

  on(handler: EventHandler): () => void {
    this.handlers.push(handler);
    return () => {
      const idx = this.handlers.indexOf(handler);
      if (idx !== -1) this.handlers.splice(idx, 1);
    };
  }

  emit(event: AgentEvent): void {
    for (const handler of this.handlers) {
      try {
        handler(event);
      } catch (err) {
        console.error("[EventBus] Handler error:", err);
      }
    }
  }
}

/** Global event bus instance */
export const globalEvents = new EventBus();
