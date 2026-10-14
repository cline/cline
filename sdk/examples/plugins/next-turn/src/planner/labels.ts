import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
	EDIT_KEPT_RATIO,
	EXCLUDED_LIMIT,
	LABEL_SCHEMA_VERSION,
	LABEL_TAGS_MAX,
	PRIVATE_FILE_MODE,
	TYPED_TEXT_LIMIT,
} from "../config";
import type { CueCode, Suggestion, TurnFacts } from "./candidates";

/**
 * The label log, the privacy gate for every suggestion event. One JSON line
 * per event in the plugin's `labels.jsonl`. The writer refuses everything the
 * schema does not name (no prompt, no why, no cue text) and hashes the one
 * text-derived field (`typedText` → `messageHash`) before anything is written.
 *
 * Schema v3 is v2 plus `tags`: the environment manifest as ids and states, so
 * pick rate can be compared across environments.
 */

export const LABEL_EVENTS = [
	"offer",
	"lineage",
	"set_ready",
	"exposed",
	"highlight_move",
	"do",
	"adjust",
	"adjust_sent",
	"adjust_abandoned",
	"skip",
	"undo_skip",
	"undo_adjust",
	"undo_turn",
	"reroll",
	"cancel_pending",
	"refused_stale",
	"key_inert",
	"superseded",
	"typed_instead",
	"ignored",
	"hidden_by_user",
] as const;
export type LabelEvent = (typeof LABEL_EVENTS)[number];

const LABEL_EVENT_SET: ReadonlySet<string> = new Set(LABEL_EVENTS);

/** Short machine tokens: no spaces, a bounded charset, 64 chars at most. Upstream's `runId` is mixed-case base62. */
export const TOKEN_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,63}$/;
const HEX64_PATTERN = /^[0-9a-f]{64}$/;
export const BUCKETS = ["same", "small", "large"] as const;
export type Bucket = (typeof BUCKETS)[number];
const BUCKET_SET: ReadonlySet<string> = new Set(BUCKETS);

export const TRIGGERS = ["after_run", "on_demand"] as const;
export type OfferTrigger = (typeof TRIGGERS)[number];

export const TOKEN_FIELDS: readonly string[] = [
	"setId",
	"candidateId",
	"kind",
	"reason",
	"verb",
	"cause",
	"input",
	"key",
	"scope",
	"turnKey",
	"offerId",
	"runId",
	"userMessageId",
	"forkedFromSessionId",
	"cueCode",
	"turnStatus",
	"planner",
	"trigger",
];
export const NUMBER_FIELDS: readonly string[] = [
	"rank",
	"position",
	"fromPosition",
	"toPosition",
	"rerollIndex",
	"msSinceExposed",
	"msToSend",
	"msIntoCountdown",
	"msSinceTurnEnd",
	"msSinceSent",
	"chars",
	"runCount",
	"beforeRunCount",
	"candidateCount",
	"filesEdited",
	"latencyMs",
	"excludedCount",
];
export const BOOLEAN_FIELDS: readonly string[] = [
	"exposedFirst",
	"turnWasRunning",
	"interleaved",
	"beforeInput",
	"toolErrored",
	"fallback",
	"reroll",
];
/** Bounded token lists, with their bound: what a set excluded, the offer's rows in rank order, and the manifest. */
export const TOKEN_LIST_FIELDS: Readonly<Record<string, number>> = {
	excluded: EXCLUDED_LIMIT,
	candidateIds: EXCLUDED_LIMIT,
	kinds: EXCLUDED_LIMIT,
	sources: EXCLUDED_LIMIT,
	tags: LABEL_TAGS_MAX,
};

export type LabelRecord = Record<string, unknown>;

export function isToken(value: unknown): value is string {
	return typeof value === "string" && TOKEN_PATTERN.test(value);
}

/**
 * Validates one label record and returns the sanitized line: `typedText`
 * reduced to `messageHash` and `chars`, every other field checked against the
 * schema, any unknown key refused as the prose it would be. Throws on the
 * first thing the schema does not name.
 */
export function buildLabelRecord(raw: unknown): LabelRecord {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw))
		throw new Error("the record must be an object");
	const record = raw as Record<string, unknown>;
	if (record.v !== LABEL_SCHEMA_VERSION)
		throw new Error(`v must be ${LABEL_SCHEMA_VERSION}`);
	if (typeof record.at !== "string" || record.at.length === 0)
		throw new Error("at must be a timestamp string");
	if (!isToken(record.sessionId)) throw new Error("sessionId must be a token");
	if (typeof record.event !== "string" || !LABEL_EVENT_SET.has(record.event))
		throw new Error("event must be one of the named events");
	const out: LabelRecord = {
		v: LABEL_SCHEMA_VERSION,
		at: record.at,
		sessionId: record.sessionId,
		event: record.event,
	};
	if (record.typedText !== undefined) {
		if (typeof record.typedText !== "string" || record.typedText.length === 0)
			throw new Error("typedText must be a non-empty string");
		if (record.typedText.length > TYPED_TEXT_LIMIT)
			throw new Error("typedText is longer than the label schema allows");
		out.messageHash = createHash("sha256")
			.update(record.typedText)
			.digest("hex");
		out.chars = record.typedText.length;
	}
	if (record.messageHash !== undefined) {
		if (
			typeof record.messageHash !== "string" ||
			!HEX64_PATTERN.test(record.messageHash)
		)
			throw new Error("messageHash must be 64 hex characters");
		out.messageHash = record.messageHash;
	}
	if (record.bucket !== undefined) {
		if (typeof record.bucket !== "string" || !BUCKET_SET.has(record.bucket))
			throw new Error("bucket must be same, small or large");
		out.bucket = record.bucket;
	}
	for (const [field, bound] of Object.entries(TOKEN_LIST_FIELDS)) {
		const value = record[field];
		if (value === undefined) continue;
		if (!Array.isArray(value) || value.length > bound)
			throw new Error(`${field} must be a bounded array`);
		for (const item of value)
			if (!isToken(item)) throw new Error(`${field} items must be tokens`);
		out[field] = value;
	}
	for (const field of TOKEN_FIELDS) {
		if (record[field] === undefined) continue;
		if (!isToken(record[field])) throw new Error(`${field} must be a token`);
		out[field] = record[field];
	}
	for (const field of NUMBER_FIELDS) {
		if (record[field] === undefined) continue;
		if (typeof record[field] !== "number" || !Number.isFinite(record[field]))
			throw new Error(`${field} must be a finite number`);
		out[field] = record[field];
	}
	for (const field of BOOLEAN_FIELDS) {
		if (record[field] === undefined) continue;
		if (typeof record[field] !== "boolean")
			throw new Error(`${field} must be a boolean`);
		out[field] = record[field];
	}
	for (const key of Object.keys(record)) {
		if (key in out || key === "typedText") continue;
		throw new Error(`${key} is not a field the label schema names`);
	}
	return out;
}

/** One served set, as the engine offered it. */
export type Offer = {
	sessionId: string;
	offerId: string;
	setId: string;
	turnKey: string;
	runCount: number;
	runId?: string;
	trigger?: OfferTrigger;
	cueCode: CueCode;
	candidates: readonly Suggestion[];
	excluded: readonly string[];
	planner: "model" | "rules";
};

export type OfferFacts = {
	turn: TurnFacts;
	latencyMs: number;
	fallback: boolean;
	tags: readonly string[];
	trigger?: OfferTrigger;
	at?: Date;
};

/**
 * The `offer` record for one served set (ADR-0021 decision 3): ids, kinds and
 * sources in rank order, the turn's facts, the manifest tags, how long it
 * took. Never a prompt or a why. A tag that is not a token (an MCP server name
 * with a space) is left out rather than failing the record.
 */
export function offerRecord(offer: Offer, facts: OfferFacts): LabelRecord {
	const trigger = facts.trigger ?? offer.trigger;
	return {
		v: LABEL_SCHEMA_VERSION,
		at: (facts.at ?? new Date()).toISOString(),
		sessionId: offer.sessionId,
		event: "offer",
		offerId: offer.offerId,
		setId: offer.setId,
		turnKey: offer.turnKey,
		runCount: offer.runCount,
		...(offer.runId && isToken(offer.runId) ? { runId: offer.runId } : {}),
		...(trigger ? { trigger } : {}),
		cueCode: offer.cueCode,
		candidateCount: offer.candidates.length,
		candidateIds: offer.candidates.map((candidate) => candidate.id),
		kinds: offer.candidates.map((candidate) => candidate.kind),
		sources: offer.candidates.map((candidate) => candidate.source),
		tags: facts.tags.filter(isToken).slice(0, LABEL_TAGS_MAX),
		excludedCount: offer.excluded.length,
		reroll: offer.excluded.length > 0,
		turnStatus: facts.turn.status,
		filesEdited: facts.turn.filesEdited,
		toolErrored: facts.turn.toolErrored,
		latencyMs: facts.latencyMs,
		fallback: facts.fallback,
		planner: offer.planner,
	};
}

/** How much of a suggestion the person kept when they edited it before sending (the tray's own measure). */
export function editBucket(suggested: string, sent: string): Bucket {
	if (suggested === sent) return "same";
	let prefix = 0;
	while (
		prefix < suggested.length &&
		prefix < sent.length &&
		suggested[prefix] === sent[prefix]
	)
		prefix += 1;
	let suffix = 0;
	while (
		suffix < suggested.length - prefix &&
		suffix < sent.length - prefix &&
		suggested[suggested.length - 1 - suffix] === sent[sent.length - 1 - suffix]
	) {
		suffix += 1;
	}
	return (prefix + suffix) / Math.max(suggested.length, sent.length) >=
		EDIT_KEPT_RATIO
		? "small"
		: "large";
}

/** Appends validated records; a record the schema refuses is reported, never written. */
export class LabelLog {
	constructor(
		private readonly path: string,
		private readonly mirror?: (record: LabelRecord) => void,
	) {}

	append(raw: unknown): LabelRecord {
		const record = buildLabelRecord(raw);
		mkdirSync(dirname(this.path), { recursive: true });
		appendFileSync(this.path, `${JSON.stringify(record)}\n`, {
			mode: PRIVATE_FILE_MODE,
		});
		this.mirror?.(record);
		return record;
	}
}
