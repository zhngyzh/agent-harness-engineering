/**
 * Channel Abstraction
 *
 * Unified interface for all communication channels.
 * Each channel receives messages and sends responses.
 * The AgentLoop is channel-agnostic.
 */

export interface InboundMessage {
  id: string;
  channel: string;
  accountId: string;
  peerId: string;
  guildId?: string;
  text: string;
  timestamp: string;
  metadata: Record<string, unknown>;
}

export interface OutboundMessage {
  targetPeerId: string;
  text: string;
  replyToId?: string;
  metadata?: Record<string, unknown>;
}

export interface Channel {
  name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  send(message: OutboundMessage): Promise<void>;
  onMessage(handler: (msg: InboundMessage) => void): void;
}
