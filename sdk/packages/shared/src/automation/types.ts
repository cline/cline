import type { GatewayModelSelection } from "../llms/gateway";
import type { AgentMode } from "../session/runtime-config";

/**
 * Trigger kinds supported by the automation subsystem.
 *
 * - `one_off`: a single run materialized from a `.cline/cron/*.md` spec.
 * - `schedule`: recurring runs materialized from a `.cline/cron/*.cron.md` spec.
 * - `event`: reactive runs materialized from a `.cline/cron/events/*.event.md`
 *   spec. Event-driven specs are defined here for contract completeness but
 *   runtime matching lives in a later feature.
 */
export type AutomationTriggerKind = "one_off" | "schedule" | "event";

/**
 * Trigger kinds persisted on `cron_runs`. Event-driven, manual, and retry
 * triggers are all first-class run sources in addition to the spec-defined
 * `one_off` and `schedule` kinds.
 */
export type AutomationRunTriggerKind =
	| "one_off"
	| "schedule"
	| "event"
	| "manual"
	| "retry";

/**
 * Lifecycle status of a queued run row in `cron_runs`.
 */
export type AutomationRunStatus =
	| "queued"
	| "running"
	| "done"
	| "failed"
	| "cancelled";

/**
 * Parse status persisted on a `cron_specs` row.
 */
export type AutomationSpecParseStatus = "valid" | "invalid";

/**
 * Common fields shared by every automation spec after parsing.
 *
 * `id` is the stable external identity derived from the frontmatter `id` field
 * when present, or from the normalized relative source path as a fallback.
 */
export interface AutomationSpecCommon {
	/** Stable external identity: frontmatter id, else normalized relative path. */
	id: string;
	/** Optional explicit frontmatter `id` (undefined when falling back to path). */
	externalId?: string;
	/** Human-readable title used in reports and list APIs. */
	title: string;
	/** Prompt text: frontmatter `prompt` if provided, otherwise the markdown body. */
	prompt: string;
	/** Absolute workspace root the automation run executes against. */
	workspaceRoot: string;
	/** Working directory inside the workspace (defaults to workspaceRoot at runtime). */
	cwd?: string;
	/** Optional model selection; when omitted the runtime default is used. */
	modelSelection?: GatewayModelSelection;
	/** System prompt override. */
	systemPrompt?: string;
	/** Agent mode. Defaults to `act` at runtime if omitted. */
	mode?: AgentMode;
	/** Hard timeout enforced by the runner. */
	timeoutSeconds?: number;
	/** Maximum agent iterations. */
	maxIterations?: number;
	/** Free-form tags. */
	tags?: readonly string[];
	/** Whether the spec is enabled. Defaults to `true`. */
	enabled: boolean;
	/** Arbitrary user metadata; stored verbatim as JSON. */
	metadata?: Readonly<Record<string, unknown>>;
}

export interface AutomationOneOffSpec extends AutomationSpecCommon {
	triggerKind: "one_off";
}

export interface AutomationScheduleSpec extends AutomationSpecCommon {
	triggerKind: "schedule";
	/** Cron expression (5 or 6 fields, parser validated by the scheduler). */
	schedule: string;
	/** IANA timezone name. Optional; falls back to runtime default. */
	timezone?: string;
}

/**
 * Event-driven spec. Feature 2 owns the matcher; Feature 1 only needs the
 * contract so `.event.md` specs parsed later surface the expected shape.
 */
export interface AutomationEventSpec extends AutomationSpecCommon {
	triggerKind: "event";
	event: string;
	filters?: Readonly<Record<string, unknown>>;
	debounceSeconds?: number;
	dedupeWindowSeconds?: number;
	cooldownSeconds?: number;
	maxParallel?: number;
}

/**
 * Discriminated union of all automation specs.
 */
export type AutomationSpec =
	| AutomationOneOffSpec
	| AutomationScheduleSpec
	| AutomationEventSpec;

/**
 * Normalized automation event envelope. Feature 2 will flesh out matching on
 * top of this contract; Feature 1 ships the scaffold so downstream modules can
 * reference it without cyclic dependencies.
 */
export interface AutomationEventEnvelope {
	eventId: string;
	eventType: string;
	source: string;
	subject?: string;
	occurredAt: string;
	workspaceRoot?: string;
	payload: unknown;
	attributes?: Readonly<Record<string, unknown>>;
	dedupeKey?: string;
}

/**
 * Source-file metadata passed into the parser. Filesystem I/O (reading the
 * file, hashing the bytes, stat-ing mtime) happens in core; the parser stays
 * pure and takes these values as inputs.
 */
export interface AutomationSpecSource {
	/**
	 * POSIX-normalized path of the source file relative to `.cline/cron/`.
	 * Used as the identity fallback and persisted in `cron_specs.source_path`.
	 */
	normalizedRelativePath: string;
	/** Bare filename (e.g. `repo-cleanup.md`). */
	filename: string;
	/** File mtime in milliseconds since the epoch. */
	mtimeMs: number;
	/** Content hash (hex sha256) of the raw file bytes. */
	hash: string;
}

export interface ParsedSpecOk {
	ok: true;
	spec: AutomationSpec;
	source: AutomationSpecSource;
	/** Non-fatal parser warnings. */
	warnings: readonly ParseIssueDetail[];
}

export interface ParsedSpecError {
	ok: false;
	source: AutomationSpecSource;
	issue: ParseIssue;
}

export type ParsedSpec = ParsedSpecOk | ParsedSpecError;

/**
 * Categorization of parser issues. `unsupported` is reserved for spec shapes
 * that are syntactically valid but intentionally deferred (e.g. `.event.md`
 * before Feature 2 lands). All other kinds are fatal for that file.
 */
export type ParseIssueKind =
	| "yaml"
	| "schema"
	| "missing_required"
	| "conflicting_fields"
	| "empty_prompt"
	| "unsupported";

export interface ParseIssueDetail {
	field?: string;
	message: string;
}

export interface ParseIssue {
	kind: ParseIssueKind;
	message: string;
	details?: readonly ParseIssueDetail[];
}
