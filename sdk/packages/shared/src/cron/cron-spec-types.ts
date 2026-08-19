/**
 * Shared types describing automation cron specs parsed from Markdown files.
 * Split out from `@cline/core` so the parser can live in `shared` where
 * multiple consumers (hub daemon, CLI tools, enterprise adapters) can validate
 * the same `.cline/cron/` spec format without pulling in core's stateful
 * orchestration layer.
 */

export type CronTriggerKind = "one_off" | "schedule" | "event";

/**
 * Which trigger kind was inferred from the source file path.
 * - `*.cron.md` -> schedule
 * - `events/*.event.md` -> event
 * - everything else under `.cline/cron/*.md` -> one_off
 */
export interface CronSpecModelSelection {
	providerId?: string;
	modelId?: string;
}

export type CronSpecMode = "act" | "plan" | "yolo";
export type CronSpecExtensionKind = "rules" | "skills" | "plugins";

export interface CronSpecCommonFields {
	/** Optional explicit id from frontmatter; falls back to relative path. */
	id?: string;
	title?: string;
	prompt?: string;
	workspaceRoot?: string;
	mode?: CronSpecMode;
	systemPrompt?: string;
	modelSelection?: CronSpecModelSelection;
	maxIterations?: number;
	timeoutSeconds?: number;
	tools?: string[];
	notesDirectory?: string;
	extensions?: CronSpecExtensionKind[];
	source?: string;
	tags?: string[];
	enabled?: boolean;
	metadata?: Record<string, unknown>;
}

export interface CronOneOffSpec extends CronSpecCommonFields {
	triggerKind: "one_off";
}

export interface CronScheduleSpec extends CronSpecCommonFields {
	triggerKind: "schedule";
	schedule: string;
	timezone?: string;
}

export interface CronEventSpec extends CronSpecCommonFields {
	triggerKind: "event";
	event: string;
	filters?: Record<string, unknown>;
	debounceSeconds?: number;
	dedupeWindowSeconds?: number;
	cooldownSeconds?: number;
	maxParallel?: number;
}

export type CronSpec = CronOneOffSpec | CronScheduleSpec | CronEventSpec;

/**
 * Result of parsing one file. Always produces a record — even invalid specs
 * are surfaced so the store can durably record parse errors rather than
 * silently dropping state.
 */
export interface CronSpecParseResult {
	/** Stable external identity: frontmatter `id` or normalized relative path. */
	externalId: string;
	/** Normalized posix-style path relative to `.cline/cron/`. */
	relativePath: string;
	/** Trigger kind inferred from file naming. */
	triggerKind: CronTriggerKind;
	/** Raw file body (without frontmatter). */
	body: string;
	/** sha256 of canonical frontmatter JSON + body. */
	contentHash: string;
	/** When the parse succeeded. */
	spec?: CronSpec;
	/** Parse error message when the spec is invalid. */
	error?: string;
}

/**
 * Normalized automation event envelope. Used by the event-driven feature
 * (Feature 2) but defined here so core, adapters, and shared validation
 * agree on the shape from day one.
 */
export interface AutomationEventEnvelope {
	eventId: string;
	eventType: string;
	source: string;
	subject?: string;
	occurredAt: string;
	workspaceRoot?: string;
	payload?: Record<string, unknown>;
	attributes?: Record<string, unknown>;
	dedupeKey?: string;
}
