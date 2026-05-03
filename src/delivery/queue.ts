/**
 * Delivery Queue
 *
 * Write-ahead queue with exponential backoff retry.
 *
 * Lifecycle:
 *   enqueue -> pending -> sending -> (delivered | retry | failed)
 *
 * Backoff schedule: 5s, 25s, 2min, 10min with +/-20% jitter
 * After max retries, message moves to failed/ directory.
 *
 * Atomic write: tmp file -> fsync -> rename (crash-safe)
 */

import { existsSync, mkdirSync, writeFileSync, renameSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { Logger } from "../observability/logger.js";
import { DELIVERY_BASE_DELAY_S, DELIVERY_BACKOFF_MULTIPLIER, DELIVERY_MAX_RETRIES, DELIVERY_JITTER_RATIO } from "../core/constants.js";
import type { OutboundMessage } from "../channels/base.js";

export interface QueuedMessage {
  id: string;
  message: OutboundMessage;
  status: "pending" | "sending" | "delivered" | "failed";
  attempts: number;
  nextRetryAt: string | null;
  createdAt: string;
  lastAttemptAt: string | null;
  error?: string;
}

export class DeliveryQueue {
  private log = new Logger("delivery");
  private queueDir: string;
  private failedDir: string;

  constructor(queueDir: string) {
    this.queueDir = queueDir;
    this.failedDir = join(queueDir, "failed");
    mkdirSync(this.queueDir, { recursive: true });
    mkdirSync(this.failedDir, { recursive: true });
  }

  /** Enqueue a message for delivery */
  enqueue(message: OutboundMessage): string {
    const id = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const queued: QueuedMessage = {
      id,
      message,
      status: "pending",
      attempts: 0,
      nextRetryAt: null,
      createdAt: new Date().toISOString(),
      lastAttemptAt: null,
    };

    this.writeAtomic(id, queued);
    this.log.info(`Message enqueued: ${id}`);
    return id;
  }

  /** Get all pending messages that are ready to send */
  getPending(): QueuedMessage[] {
    const now = new Date().toISOString();
    const pending: QueuedMessage[] = [];

    for (const file of this.listQueueFiles()) {
      try {
        const id = file.replace(/\.json$/, "");
        const msg = this.readMessage(id);
        if (msg.status === "pending") {
          if (!msg.nextRetryAt || msg.nextRetryAt <= now) {
            pending.push(msg);
          }
        }
      } catch {
        // Skip corrupted
      }
    }

    return pending;
  }

  /** Mark a message as sent successfully */
  markDelivered(id: string): void {
    const msg = this.readMessage(id);
    msg.status = "delivered";
    this.writeAtomic(id, msg);
    this.log.info(`Message delivered: ${id}`);
  }

  /** Mark a message as failed, schedule retry or move to failed */
  markFailed(id: string, error: string): void {
    const msg = this.readMessage(id);
    msg.attempts++;
    msg.lastAttemptAt = new Date().toISOString();
    msg.error = error;

    if (msg.attempts >= DELIVERY_MAX_RETRIES) {
      msg.status = "failed";
      this.moveToFailed(id, msg);
      this.log.warn(`Message failed permanently: ${id} (${msg.attempts} attempts)`);
    } else {
      msg.status = "pending";
      const delay = this.calculateBackoff(msg.attempts);
      msg.nextRetryAt = new Date(Date.now() + delay * 1000).toISOString();
      this.writeAtomic(id, msg);
      this.log.info(`Message retry scheduled: ${id} (attempt ${msg.attempts}, delay ${delay}s)`);
    }
  }

  /** Get queue stats */
  getStats(): { pending: number; failed: number; total: number } {
    const files = this.listQueueFiles();
    let pending = 0;
    let failed = 0;

    for (const file of files) {
      try {
        const id = file.replace(/\.json$/, "");
        const msg = this.readMessage(id);
        if (msg.status === "pending") pending++;
      } catch {
        // skip
      }
    }

    // Count failed files in failed/ subdirectory
    if (existsSync(this.failedDir)) {
      const failedFiles = readdirSync(this.failedDir).filter((f) => f.endsWith(".json"));
      failed = failedFiles.length;
    }

    return { pending, failed, total: files.length + failed };
  }

  // ============================================================
  // Private
  // ============================================================

  private calculateBackoff(attempt: number): number {
    let delay = DELIVERY_BASE_DELAY_S;
    for (let i = 1; i < attempt; i++) {
      delay *= DELIVERY_BACKOFF_MULTIPLIER;
    }
    // Cap at 10 minutes
    delay = Math.min(delay, 600);
    // Add jitter (+/- 20%)
    const jitter = delay * DELIVERY_JITTER_RATIO * (Math.random() * 2 - 1);
    return Math.round(delay + jitter);
  }

  private writeAtomic(id: string, msg: QueuedMessage): void {
    const filePath = join(this.queueDir, `${id}.json`);
    const tmpPath = `${filePath}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(msg, null, 2));
    renameSync(tmpPath, filePath);
  }

  private readMessage(id: string): QueuedMessage {
    const filePath = join(this.queueDir, `${id}.json`);
    return JSON.parse(readFileSync(filePath, "utf-8"));
  }

  private moveToFailed(id: string, msg: QueuedMessage): void {
    const srcPath = join(this.queueDir, `${id}.json`);
    const dstPath = join(this.failedDir, `${id}.json`);
    writeFileSync(dstPath, JSON.stringify(msg, null, 2));
    try {
      unlinkSync(srcPath);
    } catch {
      // Already gone
    }
  }

  private listQueueFiles(): string[] {
    if (!existsSync(this.queueDir)) return [];
    return readdirSync(this.queueDir).filter((f) => f.endsWith(".json"));
  }
}
