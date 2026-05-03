/**
 * Resilience Layer - Three-Tier Retry Onion
 *
 * Layer 1: Auth Profile Rotation
 *   On auth failure, rotate to next API key with cooldown tracking.
 *
 * Layer 2: Context Overflow Compaction
 *   On context overflow, compact and retry.
 *
 * Layer 3: Standard Tool-Use Loop
 *   Standard retry with error feedback to model.
 *
 * Configurable retry limits:
 *   BASE_RETRY = 24 (total attempts across all layers)
 *   PER_PROFILE = 8 (per auth profile)
 *   MAX_TOTAL = 160 (hard cap)
 */

import type { LLMClient } from "../core/types.js";
import { PER_PROFILE_RETRY, MAX_TOTAL_RETRIES } from "../core/constants.js";
import { Logger } from "../observability/logger.js";

export enum FailoverReason {
  AUTH_ERROR = "auth_error",
  RATE_LIMIT = "rate_limit",
  CONTEXT_OVERFLOW = "context_overflow",
  TIMEOUT = "timeout",
  SERVER_ERROR = "server_error",
  UNKNOWN = "unknown",
}

export interface AuthProfile {
  apiKey: string;
  baseUrl?: string;
  label: string;
  cooldownUntil: string | null;
  failureCount: number;
}

export class ProfileManager {
  private profiles: AuthProfile[];
  private currentIndex = 0;
  private log = new Logger("resilience");

  constructor(profiles: AuthProfile[]) {
    this.profiles = profiles;
  }

  /** Get the current active profile */
  current(): AuthProfile {
    return this.profiles[this.currentIndex];
  }

  /** Rotate to the next available profile */
  rotate(reason: FailoverReason): AuthProfile | null {
    const startIndex = this.currentIndex;
    let attempts = 0;

    while (attempts < this.profiles.length) {
      this.currentIndex = (this.currentIndex + 1) % this.profiles.length;
      const profile = this.profiles[this.currentIndex];

      // Skip profiles in cooldown
      if (profile.cooldownUntil && new Date(profile.cooldownUntil) > new Date()) {
        attempts++;
        continue;
      }

      this.log.info(`Profile rotated: ${this.profiles[startIndex].label} -> ${profile.label} (${reason})`);
      return profile;
    }

    this.log.error("All profiles exhausted");
    return null;
  }

  /** Put current profile in cooldown */
  cooldownCurrent(durationMs: number): void {
    const profile = this.current();
    profile.cooldownUntil = new Date(Date.now() + durationMs).toISOString();
    profile.failureCount++;
    this.log.warn(`Profile cooled down: ${profile.label} (${durationMs}ms)`);
  }
}

export class ResilienceRunner {
  private log = new Logger("resilience");

  constructor(
    private profileManager: ProfileManager,
    private llmClientFactory: (profile: AuthProfile) => LLMClient,
  ) {}

  /**
   * Execute an LLM call with full resilience.
   * Returns the response or throws after all retries exhausted.
   */
  async execute(
    messages: { role: string; content: unknown }[],
    system: string,
    tools: unknown[],
    maxTokens: number,
  ): Promise<unknown> {
    let totalAttempts = 0;
    let profileAttempts = 0;
    let lastError: Error | null = null;

    while (totalAttempts < MAX_TOTAL_RETRIES) {
      totalAttempts++;
      profileAttempts++;

      const profile = this.profileManager.current();
      const client = this.llmClientFactory(profile);

      try {
        this.log.debug(`LLM call attempt ${totalAttempts} (profile: ${profile.label})`);

        const response = await client.messages(
          "claude-sonnet-4-20250514",
          system,
          messages as never,
          tools as never,
          maxTokens,
        );

        // Success - reset profile failure count
        profile.failureCount = 0;
        return response;
      } catch (err) {
        lastError = err as Error;
        const reason = this.classifyError(err);

        this.log.warn(`LLM call failed: ${reason}`, { attempt: totalAttempts, error: lastError.message });

        // Layer 1: Auth rotation
        if (reason === FailoverReason.AUTH_ERROR || reason === FailoverReason.RATE_LIMIT) {
          this.profileManager.cooldownCurrent(60_000); // 1 min cooldown
          const nextProfile = this.profileManager.rotate(reason);
          if (!nextProfile) break;
          profileAttempts = 0;
          continue;
        }

        // Layer 2: Context overflow -> compact (handled by caller)
        if (reason === FailoverReason.CONTEXT_OVERFLOW) {
          throw new ResilienceError("Context overflow - compaction needed", reason);
        }

        // Layer 3: Standard retry
        if (profileAttempts >= PER_PROFILE_RETRY) {
          const nextProfile = this.profileManager.rotate(reason);
          if (!nextProfile) break;
          profileAttempts = 0;
        }
      }
    }

    throw new ResilienceError(
      `All retries exhausted after ${totalAttempts} attempts: ${lastError?.message}`,
      FailoverReason.UNKNOWN,
    );
  }

  private classifyError(err: unknown): FailoverReason {
    const msg = (err as Error).message.toLowerCase();
    if (msg.includes("401") || msg.includes("unauthorized") || msg.includes("invalid api key")) {
      return FailoverReason.AUTH_ERROR;
    }
    if (msg.includes("429") || msg.includes("rate limit")) {
      return FailoverReason.RATE_LIMIT;
    }
    if (msg.includes("context") || msg.includes("too long") || msg.includes("max_tokens")) {
      return FailoverReason.CONTEXT_OVERFLOW;
    }
    if (msg.includes("timeout") || msg.includes("etimedout")) {
      return FailoverReason.TIMEOUT;
    }
    if (msg.includes("500") || msg.includes("502") || msg.includes("503")) {
      return FailoverReason.SERVER_ERROR;
    }
    return FailoverReason.UNKNOWN;
  }
}

export class ResilienceError extends Error {
  constructor(
    message: string,
    public reason: FailoverReason,
  ) {
    super(message);
    this.name = "ResilienceError";
  }
}
