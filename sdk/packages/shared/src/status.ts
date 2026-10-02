/**
 * Status Hub shapes.
 *
 * A status update is one entry in an append-only, per-subject changelog. Agents
 * publish them as they work; humans and other agents read them back to answer
 * "what is happening right now" without replaying a transcript.
 *
 * Ordering is by `seq`, a monotonic cursor assigned by the store. Consumers
 * page and resume with `seq`, never with a wall clock.
 */

import { z } from "zod";

const STATUS_DETAIL_MAX = 10_000;
const STATUS_HEADLINE_TEXT_MAX = 300;
const STATUS_SUBJECT_MAX = 512;

export const STATUS_SCHEMA_VERSION = 1 as const;

/** Where a subject is in its lifecycle. */
export const StatusStateSchema = z.enum([
	"queued",
	"running",
	"blocked",
	"done",
	"failed",
	"cancelled",
]);
export type StatusState = z.infer<typeof StatusStateSchema>;

/** States that mean the subject is no longer moving on its own. */
export const TERMINAL_STATUS_STATES: readonly StatusState[] = [
	"done",
	"failed",
	"cancelled",
];

export function isTerminalStatusState(state: StatusState): boolean {
	return TERMINAL_STATUS_STATES.includes(state);
}

/**
 * How loudly an update should surface.
 *
 * Priority records the urgency of the work for readers of the Status Hub. Keep `critical` for things
 * that stop work — an agent that is blocked and cannot proceed unattended.
 */
export const StatusPrioritySchema = z.enum([
	"low",
	"normal",
	"high",
	"critical",
]);
export type StatusPriority = z.infer<typeof StatusPrioritySchema>;

export function shouldPushToUser(priority: StatusPriority): boolean {
	return priority === "high" || priority === "critical";
}

/**
 * Subject key. Caller-chosen and `/`-delimited by convention so that prefix
 * queries work: `migration/auth`, `migration/auth/step-3`, `session/<id>`.
 */
export const StatusSubjectSchema = z
	.string()
	.min(1)
	.max(STATUS_SUBJECT_MAX)
	.refine((value) => value.trim() === value && value.length > 0, {
		message: "subject must not have leading or trailing whitespace",
	});

/** What a publisher supplies. `seq`, `updateId`, and `createdAt` are assigned by the store. */
export const StatusPublishInputSchema = z
	.object({
		subject: StatusSubjectSchema,
		state: StatusStateSchema,
		/** One line, present tense, specific. This is what a human scans. */
		headline: z.string().min(1).max(STATUS_HEADLINE_TEXT_MAX),
		/** Optional prose: what was tried, what is needed, what comes next. */
		detail: z.string().max(STATUS_DETAIL_MAX).optional(),
		priority: StatusPrioritySchema.default("normal"),
		/** 0..1 when the work has a meaningful completion ratio. */
		progress: z.number().min(0).max(1).optional(),
		sessionId: z.string().min(1).optional(),
		agentId: z.string().min(1).optional(),
		agentName: z.string().min(1).optional(),
		workspaceRoot: z.string().min(1).optional(),
		/** Publisher surface: `cli`, `hub`, `vscode`, an agent tool, … */
		source: z.string().min(1).default("sdk"),
		tags: z.array(z.string().min(1)).default([]),
		metadata: z.record(z.string(), z.unknown()).optional(),
	})
	.strict();
export type StatusPublishInput = z.input<typeof StatusPublishInputSchema>;

export const StatusUpdateSchema = z
	.object({
		schemaVersion: z.literal(STATUS_SCHEMA_VERSION),
		updateId: z.string().min(1),
		/** Monotonic cursor. Strictly increasing across the whole store. */
		seq: z.number().int().nonnegative(),
		subject: StatusSubjectSchema,
		state: StatusStateSchema,
		headline: z.string().min(1),
		detail: z.string().optional(),
		priority: StatusPrioritySchema,
		progress: z.number().min(0).max(1).optional(),
		sessionId: z.string().optional(),
		agentId: z.string().optional(),
		agentName: z.string().optional(),
		workspaceRoot: z.string().optional(),
		source: z.string().min(1),
		tags: z.array(z.string()),
		metadata: z.record(z.string(), z.unknown()).optional(),
		/** Set when a newer update for the same subject arrives. Null = current. */
		supersededAt: z.string().datetime().nullable(),
		createdAt: z.string().datetime(),
		/**
		 * Total updates recorded for this subject, when the query asked for it.
		 * Turns a lone row into "update 7 of 12 for this work".
		 */
		historyCount: z.number().int().positive().optional(),
		/**
		 * State of the immediately previous update for this subject, when known.
		 * A changelog entry reads far better as `queued -> running` than as a
		 * bare `running`.
		 */
		previousState: StatusStateSchema.optional(),
	})
	.strict();
export type StatusUpdate = z.infer<typeof StatusUpdateSchema>;

/** Hard ceiling so a caller cannot ask the server for an unbounded page. */
export const STATUS_PAGE_MAX_LIMIT = 200;
export const STATUS_PAGE_DEFAULT_LIMIT = 50;

/**
 * Keyset pagination. `cursor` is the `seq` of the last row of the previous
 * page; the next page is everything strictly beyond it in `direction` order.
 *
 * Deliberately not OFFSET: offset paging rescans skipped rows, so deep pages
 * of a long changelog get slower the further you scroll. Keyset stays flat.
 */
export const StatusQuerySchema = z
	.object({
		/** Exact subject match. */
		subject: StatusSubjectSchema.optional(),
		/** Subject prefix, e.g. `migration/` for a project. */
		subjectPrefix: z.string().min(1).max(STATUS_SUBJECT_MAX).optional(),
		state: z.array(StatusStateSchema).nonempty().optional(),
		priority: z.array(StatusPrioritySchema).nonempty().optional(),
		/**
		 * Rows carrying *every* one of these tags.
		 *
		 * AND rather than the IN semantics `state` and `priority` use, because a
		 * tag chip row is a narrowing facet: each chip's count comes from
		 * `tagFacets` over the set this very query matched, so clicking one has
		 * to shrink that set to the number the chip promised. OR would grow it
		 * instead and make every count a lie.
		 */
		tags: z.array(z.string().min(1)).nonempty().optional(),
		sessionId: z.string().min(1).optional(),
		agentId: z.string().min(1).optional(),
		workspaceRoot: z.string().min(1).optional(),
		/** Free text over headline and detail. */
		text: z.string().min(1).max(STATUS_HEADLINE_TEXT_MAX).optional(),
		/** Only the newest update per subject. The "current state of everything" view. */
		currentOnly: z.boolean().default(false),
		/** Keyset cursor: the `seq` of the last row you already have. */
		cursor: z.number().int().nonnegative().optional(),
		direction: z.enum(["older", "newer"]).default("older"),
		/**
		 * `recency` is a pure changelog: newest first.
		 *
		 * `attention` puts what needs a human first — blocked, then failed, then
		 * running, then the rest — and only orders by recency inside each band.
		 * That is what makes the board a board rather than a second changelog:
		 * page 1 is the work that is stuck, not the work that happened to move
		 * most recently.
		 */
		orderBy: z.enum(["recency", "attention"]).default("recency"),
		/**
		 * Include how many total updates each subject has. One correlated count
		 * per row, so it is opt-in rather than paid for on every changelog page.
		 */
		includeHistoryCount: z.boolean().default(false),
		/**
		 * Include `total` and `tagFacets` — counts over the whole set this query
		 * matches, ignoring `cursor` and `limit`.
		 *
		 * Two extra aggregates over the filtered set, so it is opt-in like
		 * `includeHistoryCount` rather than paid for by every caller. The chip
		 * row in the Status Hub is the reason it exists: a facet count is a
		 * promise about what clicking it returns, and a click re-queries the
		 * table rather than re-filtering the page it is drawn from.
		 */
		includeFacets: z.boolean().default(false),
		limit: z
			.number()
			.int()
			.positive()
			.max(STATUS_PAGE_MAX_LIMIT)
			.default(STATUS_PAGE_DEFAULT_LIMIT),
	})
	.strict();
export type StatusQuery = z.input<typeof StatusQuerySchema>;
export type ResolvedStatusQuery = z.infer<typeof StatusQuerySchema>;

/** How many rows in a result set carry one tag. */
export const StatusTagCountSchema = z
	.object({
		tag: z.string().min(1),
		count: z.number().int().positive(),
	})
	.strict();
export type StatusTagCount = z.infer<typeof StatusTagCountSchema>;

/**
 * Ceiling on how many tag facets one page carries, mirroring the cap
 * `summary()` puts on `byAgent`. A store with thousands of distinct tags must
 * not turn every page into an unbounded response.
 *
 * Facets come back by descending count, so truncation drops the rarest chips.
 * Tags named in `tags` are exempt and always come back: the cap breaks count
 * ties alphabetically, so a selected tag really can tie with 50 earlier ones
 * and fall off the end — and its chip would then render at zero next to a
 * non-zero result count, which is the contradiction facets exist to prevent.
 */
export const STATUS_TAG_FACET_LIMIT = 50;

export const StatusPageSchema = z
	.object({
		updates: z.array(StatusUpdateSchema),
		/** Pass back as `cursor` to fetch the next page. Null when exhausted. */
		nextCursor: z.number().int().nonnegative().nullable(),
		hasMore: z.boolean(),
		/**
		 * Rows matching this query in total, ignoring `cursor` and `limit`.
		 * Present only when `includeFacets` asked for it.
		 */
		total: z.number().int().nonnegative().optional(),
		/**
		 * Per-tag counts over that same whole set, descending, capped at
		 * `STATUS_TAG_FACET_LIMIT`. Present only when `includeFacets` asked.
		 */
		tagFacets: z.array(StatusTagCountSchema).optional(),
	})
	.strict();
export type StatusPage = z.infer<typeof StatusPageSchema>;

/**
 * Aggregates over *live* rows only (one per subject).
 *
 * Computed server-side rather than counted from a page, because a page is at
 * most `limit` rows and counting from it would silently under-report — a board
 * that says "3 blocked" when 40 are blocked is worse than no board.
 */
export const StatusSummarySchema = z
	.object({
		total: z.number().int().nonnegative(),
		byState: z.record(StatusStateSchema, z.number().int().nonnegative()),
		byAgent: z.array(
			z.object({
				agentId: z.string(),
				agentName: z.string().optional(),
				total: z.number().int().nonnegative(),
				blocked: z.number().int().nonnegative(),
				running: z.number().int().nonnegative(),
				/**
				 * The subject of this agent's most recent live row.
				 *
				 * Evidence, not a label: a client derives a readable name from
				 * it, and the derivation stays a pure function on the client
				 * where it can be tested against frozen input. `subject` is the
				 * right evidence because the tool's own schema calls it a
				 * "stable slug for the piece of work" and tells agents to reuse
				 * it, where `headline` changes on every publish — a name taken
				 * from prose would rename the agent five times an hour.
				 */
				latestSubject: z.string().nullable(),
				/** Orders the pick above; `seq` is unique and strictly increasing. */
				latestSeq: z.number().int().nonnegative(),
				/**
				 * How many distinct pieces of work this agent has live.
				 *
				 * Carried because the label names only the most recent one, and
				 * a reader deserves to know when that is a summary rather than
				 * the whole story.
				 */
				subjectCount: z.number().int().nonnegative(),
			}),
		),
		/** ISO instant of the most recent update anywhere, if any. */
		lastUpdatedAt: z.string().datetime().nullable(),
	})
	.strict();
export type StatusSummary = z.infer<typeof StatusSummarySchema>;

export const StatusPrunePayloadSchema = z
	.object({
		/** Delete superseded rows created strictly before this ISO instant. */
		before: z.string().datetime().optional(),
		/** Keep at most N historical rows per subject, newest first. */
		keepPerSubject: z.number().int().positive().optional(),
	})
	.strict()
	.refine((value) => value.before != null || value.keepPerSubject != null, {
		message: "prune requires before or keepPerSubject",
	});
export type StatusPrunePayload = z.infer<typeof StatusPrunePayloadSchema>;

export function parseStatusUpdate(input: unknown): StatusUpdate {
	return StatusUpdateSchema.parse(input);
}

export function parseStatusQuery(input: unknown): ResolvedStatusQuery {
	return StatusQuerySchema.parse(input ?? {});
}
