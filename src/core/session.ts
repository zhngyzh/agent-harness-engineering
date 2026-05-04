/**
 * Session Store
 *
 * JSONL-based session persistence.
 * - Append-on-write for durability
 * - Replay-on-read for context restoration
 * - Metadata tracked separately for fast listing
 *
 * Design: Sessions are immutable logs. Compaction creates a new session
 * with a summary, preserving the original.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Message, SessionLine, SessionMeta } from "./types.js";
import { SESSION_FILE_EXT, SESSION_META_FILE_PREFIX, SESSION_META_FILE_SUFFIX } from "./constants.js";

export class SessionStore {
  readonly sessionId: string;
  private readonly sessionDir: string;
  private readonly filePath: string;
  private messageCount = 0;

  constructor(
    workspaceDir: string,
    sessionId?: string,
  ) {
    this.sessionDir = join(workspaceDir, ".sessions");
    this.sessionId = sessionId || this.generateSessionId();
    this.filePath = join(this.sessionDir, `${this.sessionId}${SESSION_FILE_EXT}`);

    mkdirSync(this.sessionDir, { recursive: true });

    if (!existsSync(this.filePath)) {
      this.writeMeta({
        id: this.sessionId,
        agentName: "default",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messageCount: 0,
        totalTokens: 0,
        status: "active",
      });
    } else {
      this.messageCount = this.countLines();
    }
  }

  /** Append only new messages to the session log */
  async appendMessages(messages: Message[]): Promise<void> {
    const newMessages = messages.slice(this.messageCount);
    if (newMessages.length === 0) return;

    const lines = newMessages.map((m) =>
      JSON.stringify({
        type: "message" as const,
        data: m,
        timestamp: new Date().toISOString(),
      }),
    );

    for (const line of lines) {
      appendFileSync(this.filePath, `${line}\n`, "utf-8");
    }

    this.messageCount = messages.length;
    this.updateMeta({ messageCount: this.messageCount, updatedAt: new Date().toISOString() });
  }

  /** Read all messages from the session */
  readMessages(): Message[] {
    if (!existsSync(this.filePath)) return [];

    const content = readFileSync(this.filePath, "utf-8");
    const messages: Message[] = [];

    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        const record: SessionLine = JSON.parse(line);
        if (record.type === "message") {
          messages.push(record.data as Message);
        }
      } catch {
        // Skip corrupted lines
      }
    }

    return messages;
  }

  /** Get session metadata */
  getMeta(): SessionMeta | null {
    const metaPath = this.metaFilePath();
    if (!existsSync(metaPath)) return null;
    return JSON.parse(readFileSync(metaPath, "utf-8"));
  }

  /** List all sessions — includes sessions with only a meta file (no messages yet) */
  static listSessions(workspaceDir: string): SessionMeta[] {
    const sessionDir = join(workspaceDir, ".sessions");
    if (!existsSync(sessionDir)) return [];

    const allFiles = readdirSync(sessionDir);
    // Collect session IDs from both .jsonl files and _meta.json files
    const sessionIds = new Set<string>();
    for (const f of allFiles) {
      if (f.endsWith(SESSION_FILE_EXT)) {
        sessionIds.add(f.replace(SESSION_FILE_EXT, ""));
      } else if (f.endsWith(SESSION_META_FILE_SUFFIX)) {
        const id = f.slice(SESSION_META_FILE_PREFIX.length, -SESSION_META_FILE_SUFFIX.length);
        if (id) sessionIds.add(id);
      }
    }

    return Array.from(sessionIds).map((id) => {
      const jsonlPath = join(sessionDir, `${id}${SESSION_FILE_EXT}`);
      let messageCount = 0;
      let createdAt: string | undefined;
      if (existsSync(jsonlPath)) {
        const content = readFileSync(jsonlPath, "utf-8");
        for (const line of content.split("\n")) {
          if (!line.trim()) continue;
          try {
            const record = JSON.parse(line);
            if (record.type === "message") messageCount++;
          } catch {
            // skip
          }
        }
      }
      // Prefer meta file for timestamps
      const metaPath = join(sessionDir, `${SESSION_META_FILE_PREFIX}${id}${SESSION_META_FILE_SUFFIX}`);
      if (existsSync(metaPath)) {
        try {
          const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
          return { ...meta, messageCount: messageCount || meta.messageCount };
        } catch {
          // fall through
        }
      }
      return {
        id,
        agentName: "default",
        createdAt: createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messageCount,
        totalTokens: 0,
        status: "active" as const,
      };
    });
  }

  // ============================================================
  // Private
  // ============================================================

  private generateSessionId(): string {
    const now = new Date();
    const ts = now.toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
    const rand = Math.random().toString(36).slice(2, 8);
    return `s-${ts}-${rand}`;
  }

  private countLines(): number {
    if (!existsSync(this.filePath)) return 0;
    const content = readFileSync(this.filePath, "utf-8");
    return content.split("\n").filter((l) => l.trim()).length;
  }

  private metaFilePath(): string {
    return join(this.sessionDir, `${SESSION_META_FILE_PREFIX}${this.sessionId}${SESSION_META_FILE_SUFFIX}`);
  }

  private writeMeta(meta: SessionMeta): void {
    const metaPath = this.metaFilePath();
    writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  }

  private updateMeta(pick: Partial<SessionMeta>): void {
    const meta = this.getMeta();
    if (meta) {
      this.writeMeta({ ...meta, ...pick });
    }
  }
}
