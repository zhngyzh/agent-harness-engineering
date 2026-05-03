/**
 * Prompt Cache Optimization
 *
 * Splits the system prompt into cache-friendly blocks.
 * Static content (before the boundary) can be prefix-cached by the LLM provider,
 * reducing costs and latency for subsequent turns.
 *
 * Structure:
 *   [{ text: "static prefix...", cacheScope: 'global' },  ← cached
 *    { text: "dynamic content...", cacheScope: null }]     ← not cached
 *
 * The cache boundary marker separates static from dynamic content.
 */

import { CACHE_BOUNDARY } from "../core/constants.js";

export interface CacheBlock {
  text: string;
  cacheScope: "global" | "org" | null;
}

export class PromptCache {
  /**
   * Split a system prompt into cache-optimized blocks.
   * Everything before the boundary is marked as cacheable.
   */
  static split(systemPrompt: string): CacheBlock[] {
    const boundaryIndex = systemPrompt.indexOf(CACHE_BOUNDARY);

    if (boundaryIndex === -1) {
      // No boundary found — treat everything as non-cacheable
      return [{ text: systemPrompt, cacheScope: null }];
    }

    const staticPart = systemPrompt.slice(0, boundaryIndex).trim();
    const dynamicPart = systemPrompt.slice(boundaryIndex + CACHE_BOUNDARY.length).trim();

    const blocks: CacheBlock[] = [];

    if (staticPart) {
      blocks.push({ text: staticPart, cacheScope: "global" });
    }

    // The boundary marker itself is not cached
    blocks.push({ text: CACHE_BOUNDARY, cacheScope: null });

    if (dynamicPart) {
      blocks.push({ text: dynamicPart, cacheScope: null });
    }

    return blocks;
  }

  /**
   * Calculate cache hit ratio (how much of the prompt is cacheable).
   */
  static cacheRatio(systemPrompt: string): number {
    const boundaryIndex = systemPrompt.indexOf(CACHE_BOUNDARY);
    if (boundaryIndex === -1) return 0;
    return boundaryIndex / systemPrompt.length;
  }
}
