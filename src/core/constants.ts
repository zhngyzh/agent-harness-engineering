/**
 * System-wide constants.
 *
 * Design note: Magic numbers are centralized here.
 * These are tuning knobs, not business logic.
 */

// ---------- Context Management ----------
/** Maximum characters per bootstrap file (20KB) */
export const MAX_FILE_CHARS = 20_000;

/** Maximum total characters across all bootstrap files (150KB) */
export const MAX_TOTAL_BOOTSTRAP_CHARS = 150_000;

/** Maximum number of skills to load */
export const MAX_SKILLS = 150;

/** Maximum characters for skills in system prompt */
export const MAX_SKILLS_PROMPT_CHARS = 30_000;

// ---------- Context Compaction ----------
/** Trigger auto-compaction at this context usage ratio */
export const COMPACTION_THRESHOLD = 0.85;

/** Target ratio after compaction */
export const COMPACTION_TARGET = 0.5;

/** Micro-compact: truncate tool results longer than this */
export const MICRO_COMPACT_TRUNCATE_CHARS = 4_000;

// ---------- Delivery Queue ----------
/** Base delay for exponential backoff (seconds) */
export const DELIVERY_BASE_DELAY_S = 5;

/** Backoff multiplier */
export const DELIVERY_BACKOFF_MULTIPLIER = 5;

/** Max retry attempts */
export const DELIVERY_MAX_RETRIES = 5;

/** Jitter range (+/- 20%) */
export const DELIVERY_JITTER_RATIO = 0.2;

// ---------- Resilience ----------
/** Base retry count for tool-use loop */
export const BASE_RETRY_COUNT = 24;

/** Retry count per auth profile */
export const PER_PROFILE_RETRY = 8;

/** Maximum total retries across all profiles */
export const MAX_TOTAL_RETRIES = 160;

// ---------- Bootstrap Files ----------
/** Files loaded in order during bootstrap */
export const BOOTSTRAP_FILES = [
	"SOUL.md",
	"IDENTITY.md",
	"TOOLS.md",
	"USER.md",
	"HEARTBEAT.md",
	"BOOTSTRAP.md",
	"AGENTS.md",
	"MEMORY.md",
] as const;

// ---------- Session ----------
/** Session file extension */
export const SESSION_FILE_EXT = ".jsonl";

/** Session metadata file name template (per-session: {sessionId}_meta.json) */
export const SESSION_META_FILE_PREFIX = "";
export const SESSION_META_FILE_SUFFIX = "_meta.json";

// ---------- Security ----------
/** Patterns that indicate prompt injection attempts */
export const INJECTION_PATTERNS = [
	/ignore\s+(previous|all|above)\s+instructions/i,
	/system\s+prompt\s+(override|replace|ignore)/i,
	/you\s+are\s+now\s+(a|an|the)/i,
	/disregard\s+(your|all)\s+(previous|prior|instructions)/i,
	/\[SYSTEM\s*[:\]]/i,
	/<system>/i,
	/new\s+persona/i,
	/jailbreak/i,
	/DAN\s+mode/i,
] as const;

// ---------- Cache ----------
/** Cache boundary marker for prompt prefix caching */
export const CACHE_BOUNDARY = "__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__";
