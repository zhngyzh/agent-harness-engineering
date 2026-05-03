/**
 * Prompt Injection Defense
 *
 * Multi-layered defense against prompt injection attacks:
 *
 *   Layer 1 — Pattern matching (known attack signatures)
 *     Regex patterns for common injection techniques:
 *     - "Ignore previous instructions"
 *     - "System prompt override"
 *     - "You are now..." persona hijacking
 *     - Delimiter injection (<system>, [SYSTEM])
 *
 *   Layer 2 — Structural analysis
 *     - Detects unusual delimiter patterns
 *     - Checks for role confusion markers
 *     - Identifies instruction-like content in user messages
 *
 *   Layer 3 — Entropy analysis
 *     - Detects obfuscated content (unusual character distributions)
 *     - Identifies encoding tricks (base64, unicode tricks)
 *
 * Design principles:
 *   - Defense in depth: multiple layers
 *   - Fail secure: suspicious content is blocked
 *   - Low false positive: only block clear injection attempts
 *   - All detections are logged for analysis
 */

import { existsSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { Logger } from "../observability/logger.js";
import { INJECTION_PATTERNS } from "../core/constants.js";

export type InjectionRisk = "none" | "low" | "medium" | "high" | "critical";

export interface InjectionFinding {
  layer: "pattern" | "structural" | "entropy";
  risk: InjectionRisk;
  description: string;
  matchedPattern?: string;
  position?: number;
}

export interface ScanResult {
  input: string;
  risk: InjectionRisk;
  findings: InjectionFinding[];
  sanitized: string;
  scannedAt: string;
}

// Structural markers that indicate role confusion
const ROLE_MARKERS = [
  /\b(assistant|system|user|human|ai|bot)\s*:/gi,
  /\b(you are|i am|act as|pretend to be|roleplay as)\b/gi,
  /```\s*(system|instructions?|prompt)/gi,
];

// Delimiter patterns that could confuse the model
const DELIMITER_PATTERNS = [
  /<system>/gi,
  /<\/system>/gi,
  /<instructions?>/gi,
  /\[SYSTEM\]/gi,
  /\[INST\]/gi,
  /###\s*(system|instructions?|human|assistant)/gi,
];

// Encoding/obfuscation patterns
const OBFUSCATION_PATTERNS = {
  base64: /[A-Za-z0-9+/=]{20,}/g,
  unicodeEscapes: /\\u[0-9a-fA-F]{4}/g,
  zeroWidth: /[​-‍﻿]/g,
  homoglyphs: /[АВЕКМОРСТХ]/g, // Cyrillic lookalikes
};

export class InjectionDefense {
  private log = new Logger("injection-defense");
  private auditDir: string;

  constructor(workspaceDir: string) {
    this.auditDir = join(workspaceDir, ".security");
    mkdirSync(this.auditDir, { recursive: true });
  }

  /**
   * Scan input for injection attempts across all layers.
   * Returns a ScanResult with risk level and findings.
   */
  scan(input: string): ScanResult {
    const findings: InjectionFinding[] = [];

    // Layer 1: Pattern matching
    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(input)) {
        findings.push({
          layer: "pattern",
          risk: "high",
          description: "Known injection pattern detected",
          matchedPattern: pattern.source,
        });
      }
    }

    // Layer 2: Structural analysis
    for (const marker of ROLE_MARKERS) {
      const match = input.match(marker);
      if (match) {
        findings.push({
          layer: "structural",
          risk: "medium",
          description: "Role confusion marker detected",
          matchedPattern: marker.source,
          position: match.index,
        });
      }
    }

    for (const delim of DELIMITER_PATTERNS) {
      if (delim.test(input)) {
        findings.push({
          layer: "structural",
          risk: "high",
          description: "Delimiter injection detected",
          matchedPattern: delim.source,
        });
      }
    }

    // Layer 3: Entropy/obfuscation analysis
    // Check for base64 blocks
    const base64Matches = input.match(OBFUSCATION_PATTERNS.base64);
    if (base64Matches && base64Matches.length > 0) {
      const totalB64Len = base64Matches.reduce((s, m) => s + m.length, 0);
      if (totalB64Len > input.length * 0.3) {
        findings.push({
          layer: "entropy",
          risk: "medium",
          description: `Suspicious base64 content (${totalB64Len} chars, ${Math.round(totalB64Len / input.length * 100)}% of input)`,
        });
      }
    }

    // Check for zero-width characters
    const zwMatches = input.match(OBFUSCATION_PATTERNS.zeroWidth);
    if (zwMatches && zwMatches.length > 0) {
      findings.push({
        layer: "entropy",
        risk: "high",
        description: `Zero-width characters detected (${zwMatches.length} occurrences)`,
      });
    }

    // Check for homoglyphs
    const homoglyphMatches = input.match(OBFUSCATION_PATTERNS.homoglyphs);
    if (homoglyphMatches && homoglyphMatches.length > 0) {
      findings.push({
        layer: "entropy",
        risk: "medium",
        description: `Homoglyph characters detected (${homoglyphMatches.length} occurrences)`,
      });
    }

    // Unicode escape sequences
    const unicodeMatches = input.match(OBFUSCATION_PATTERNS.unicodeEscapes);
    if (unicodeMatches && unicodeMatches.length > 3) {
      findings.push({
        layer: "entropy",
        risk: "low",
        description: `Unicode escape sequences (${unicodeMatches.length} occurrences)`,
      });
    }

    // Determine overall risk
    const risk = this.calculateRisk(findings);
    const sanitized = this.sanitize(input, findings);

    const result: ScanResult = {
      input: input.slice(0, 100) + (input.length > 100 ? "..." : ""),
      risk,
      findings,
      sanitized,
      scannedAt: new Date().toISOString(),
    };

    if (risk !== "none") {
      this.log.warn(`Injection scan: ${risk} risk, ${findings.length} findings`);
      this.audit(result);
    }

    return result;
  }

  /** Quick check — returns true if input is safe */
  isSafe(input: string): boolean {
    return this.scan(input).risk === "none";
  }

  // ============================================================
  // Private
  // ============================================================

  private calculateRisk(findings: InjectionFinding[]): InjectionRisk {
    if (findings.length === 0) return "none";

    const riskScores: Record<InjectionRisk, number> = {
      none: 0, low: 1, medium: 2, high: 3, critical: 4,
    };

    let maxScore = 0;
    for (const finding of findings) {
      const score = riskScores[finding.risk];
      if (score > maxScore) maxScore = score;
    }

    // Multiple medium+ findings escalate to high
    const mediumPlus = findings.filter((f) => riskScores[f.risk] >= 2).length;
    if (mediumPlus >= 3 && maxScore < 3) maxScore = 3;

    const riskLevels: InjectionRisk[] = ["none", "low", "medium", "high", "critical"];
    return riskLevels[maxScore];
  }

  private sanitize(input: string, findings: InjectionFinding[]): string {
    let sanitized = input;

    // Remove zero-width characters
    sanitized = sanitized.replace(/[​-‍﻿]/g, "");

    // Remove delimiter injection markers
    sanitized = sanitized.replace(/<system>/gi, "[BLOCKED]");
    sanitized = sanitized.replace(/<\/system>/gi, "[BLOCKED]");
    sanitized = sanitized.replace(/\[SYSTEM\]/gi, "[BLOCKED]");

    return sanitized;
  }

  private audit(result: ScanResult): void {
    const today = new Date().toISOString().slice(0, 10);
    const filePath = join(this.auditDir, `injection-${today}.jsonl`);
    appendFileSync(filePath, `${JSON.stringify(result)}\n`, "utf-8");
  }
}
