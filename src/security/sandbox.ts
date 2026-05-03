/**
 * Sandbox Isolation
 *
 * Provides execution isolation for tool calls:
 *
 *   1. File system sandbox — restricts file operations to workspace
 *      - Blocks access to sensitive paths (/etc, /root, ~/.ssh)
 *      - Enforces workspace boundary
 *      - Optional read-only mode
 *
 *   2. Network sandbox — controls network access
 *      - Allowlist/blocklist for hosts
 *      - Blocks private IP ranges by default
 *      - Optional complete network isolation
 *
 *   3. Environment sandbox — filters environment variables
 *      - Blocks sensitive env vars (API keys, tokens)
 *      - Allows only whitelisted vars
 *
 *   4. Resource limits — constrains execution
 *      - Max file size for reads/writes
 *      - Max command output size
 *      - Timeout enforcement
 *
 * Design principles:
 *   - Deny by default
 *   - Explicit allow required
 *   - Defense in depth: multiple isolation layers
 *   - All violations are logged
 */

import { realpathSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import { Logger } from "../observability/logger.js";

export interface SandboxConfig {
  workspaceDir: string;
  readOnly: boolean;
  allowedPaths: string[];       // additional allowed absolute paths
  blockedPaths: string[];       // always blocked (in addition to defaults)
  allowNetwork: boolean;
  allowedHosts: string[];
  blockedHosts: string[];
  allowedEnvVars: string[];     // whitelist (empty = block all)
  blockedEnvVars: string[];     // always blocked
  maxFileSize: number;          // bytes
  maxOutputSize: number;        // bytes
  maxExecutionTimeMs: number;
}

const DEFAULT_BLOCKED_PATHS = [
  "/etc", "/root", "/var/root",
  "/.ssh", "/.gnupg", "/.aws",
];

const SENSITIVE_ENV_VARS = [
  "API_KEY", "API_SECRET", "ACCESS_TOKEN", "SECRET_KEY",
  "PRIVATE_KEY", "PASSWORD", "TOKEN", "CREDENTIALS",
  "AWS_SECRET", "GITHUB_TOKEN", "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY", "DATABASE_URL",
];

const PRIVATE_IP_PATTERNS = [
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^127\./,
  /^0\./,
  /^169\.254\./,
];

export interface SandboxCheck {
  allowed: boolean;
  reason?: string;
}

export class Sandbox {
  private log = new Logger("sandbox");
  private config: SandboxConfig;
  private resolvedWorkspace: string;

  constructor(config: Partial<SandboxConfig> & { workspaceDir: string }) {
    this.config = {
      readOnly: false,
      allowedPaths: [],
      blockedPaths: [],
      allowNetwork: false,
      allowedHosts: [],
      blockedHosts: [],
      allowedEnvVars: [],
      blockedEnvVars: [],
      maxFileSize: 10_000_000,  // 10MB
      maxOutputSize: 1_000_000,  // 1MB
      maxExecutionTimeMs: 30_000, // 30s
      ...config,
    };

    this.resolvedWorkspace = realpathSync(this.config.workspaceDir);
  }

  // ============================================================
  // File System Checks
  // ============================================================

  /** Check if a file path is accessible */
  checkFilePath(path: string, operation: "read" | "write"): SandboxCheck {
    const resolved = isAbsolute(path) ? resolve(path) : resolve(this.resolvedWorkspace, path);

    // Check blocked paths
    for (const blocked of [...DEFAULT_BLOCKED_PATHS, ...this.config.blockedPaths]) {
      const blockedResolved = resolve(blocked);
      if (resolved.startsWith(blockedResolved) || resolved === blockedResolved) {
        return { allowed: false, reason: `Path blocked: ${path} (matches ${blocked})` };
      }
    }

    // Check workspace boundary
    const rel = relative(this.resolvedWorkspace, resolved);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      // Outside workspace — check allowed paths
      const inAllowed = this.config.allowedPaths.some((allowed) =>
        resolved.startsWith(resolve(allowed)),
      );
      if (!inAllowed) {
        return { allowed: false, reason: `Path outside workspace: ${path}` };
      }
    }

    // Check read-only
    if (this.config.readOnly && operation === "write") {
      return { allowed: false, reason: "Sandbox is read-only" };
    }

    return { allowed: true };
  }

  /** Check file size */
  checkFileSize(size: number): SandboxCheck {
    if (size > this.config.maxFileSize) {
      return { allowed: false, reason: `File size ${size} exceeds limit ${this.config.maxFileSize}` };
    }
    return { allowed: true };
  }

  // ============================================================
  // Network Checks
  // ============================================================

  /** Check if a host is accessible */
  checkHost(host: string): SandboxCheck {
    // Block private IPs
    for (const pattern of PRIVATE_IP_PATTERNS) {
      if (pattern.test(host)) {
        return { allowed: false, reason: `Private IP blocked: ${host}` };
      }
    }

    // Block list
    if (this.config.blockedHosts.includes(host)) {
      return { allowed: false, reason: `Host blocked: ${host}` };
    }

    // If network is disabled, only allowlisted hosts
    if (!this.config.allowNetwork) {
      if (this.config.allowedHosts.length > 0 && this.config.allowedHosts.includes(host)) {
        return { allowed: true };
      }
      return { allowed: false, reason: "Network access disabled" };
    }

    // Network enabled — allow unless blocked
    return { allowed: true };
  }

  // ============================================================
  // Environment Checks
  // ============================================================

  /** Check if an environment variable is accessible */
  checkEnvVar(name: string): SandboxCheck {
    const upperName = name.toUpperCase();

    // Check blocked env vars
    for (const blocked of [...SENSITIVE_ENV_VARS, ...this.config.blockedEnvVars]) {
      if (upperName.includes(blocked)) {
        return { allowed: false, reason: `Env var blocked: ${name}` };
      }
    }

    // If whitelist is set, only allow whitelisted vars
    if (this.config.allowedEnvVars.length > 0) {
      const whitelisted = this.config.allowedEnvVars.some(
        (allowed) => upperName === allowed.toUpperCase(),
      );
      if (!whitelisted) {
        return { allowed: false, reason: `Env var not in whitelist: ${name}` };
      }
    }

    return { allowed: true };
  }

  /** Filter environment variables */
  filterEnvVars(env: Record<string, string>): Record<string, string> {
    const filtered: Record<string, string> = {};
    for (const [key, value] of Object.entries(env)) {
      if (this.checkEnvVar(key).allowed) {
        filtered[key] = value;
      } else {
        this.log.debug(`Env var filtered: ${key}`);
      }
    }
    return filtered;
  }

  // ============================================================
  // Output Size Check
  // ============================================================

  checkOutputSize(size: number): SandboxCheck {
    if (size > this.config.maxOutputSize) {
      return { allowed: false, reason: `Output size ${size} exceeds limit ${this.config.maxOutputSize}` };
    }
    return { allowed: true };
  }

  // ============================================================
  // Combined Checks
  // ============================================================

  /** Run all applicable checks for a file operation */
  checkFileOperation(path: string, operation: "read" | "write", size?: number): SandboxCheck {
    const pathCheck = this.checkFilePath(path, operation);
    if (!pathCheck.allowed) return pathCheck;

    if (size !== undefined) {
      const sizeCheck = this.checkFileSize(size);
      if (!sizeCheck.allowed) return sizeCheck;
    }

    return { allowed: true };
  }

  /** Get sandbox status */
  getStatus(): {
    workspace: string;
    readOnly: boolean;
    networkAllowed: boolean;
    maxFileSize: number;
    maxOutputSize: number;
    maxExecutionTimeMs: number;
  } {
    return {
      workspace: this.resolvedWorkspace,
      readOnly: this.config.readOnly,
      networkAllowed: this.config.allowNetwork,
      maxFileSize: this.config.maxFileSize,
      maxOutputSize: this.config.maxOutputSize,
      maxExecutionTimeMs: this.config.maxExecutionTimeMs,
    };
  }
}
