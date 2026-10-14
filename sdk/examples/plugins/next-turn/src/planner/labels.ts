import {
	EDIT_KEPT_RATIO,
	EXCLUDED_LIMIT,
	LABEL_SCHEMA_VERSION,
	LABEL_TAGS_MAX,
	TYPED_TEXT_LIMIT,
} from "../config";
import { appendJsonLine, sha256Hex } from "../store/data-dir";
import { isRecord } from "../values";
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
export const HEX64_PATTERN = /^[0-9a-f]{64}$/;
const BUCKETS = ["same", "small", "large"] as const;
type Bucket = (typeof BUCKETS)[number];

export const TRIGGERS = ["after_run", "on_demand"] as const;
export type OfferTrigger = (typeof TRIGGERS)[number];

export const PLANNERS = ["rules", "model"] as const;
type Planner = (typeof PLANNERS)[number];

export type FieldSpec =
	| { kind: "token" }
	| { kind: "enum"; values: readonly string[] }
	| { kind: "number" }
	| { kind: "boolean" }
	| { kind: "tokens"; maxItems: number }
	| { kind: "hex64"; description: string };

const TOKEN = { kind: "token" } as const satisfies FieldSpec;
const NUMBER = { kind: "number" } as const satisfies FieldSpec;
const BOOLEAN = { kind: "boolean" } as const satisfies FieldSpec;

/**
 * Every field a record may carry besides its header, in the published
 * schema's order. The token lists are bounded: what a set excluded, the
 * offer's rows in rank order, and the manifest.
 */
export const LABEL_FIELDS = {
	messageHash: {
		kind: "hex64",
		description:
			"sha256 of what the person typed; the text itself is never written",
	},
	bucket: { kind: "enum", values: BUCKETS },
	setId: TOKEN,
	candidateId: TOKEN,
	kind: TOKEN,
	reason: TOKEN,
	verb: TOKEN,
	cause: TOKEN,
	input: TOKEN,
	key: TOKEN,
	scope: TOKEN,
	turnKey: TOKEN,
	offerId: TOKEN,
	runId: TOKEN,
	userMessageId: TOKEN,
	forkedFromSessionId: TOKEN,
	cueCode: TOKEN,
	turnStatus: TOKEN,
	planner: TOKEN,
	trigger: { kind: "enum", values: TRIGGERS },
	rank: NUMBER,
	position: NUMBER,
	fromPosition: NUMBER,
	toPosition: NUMBER,
	rerollIndex: NUMBER,
	msSinceExposed: NUMBER,
	msToSend: NUMBER,
	msIntoCountdown: NUMBER,
	msSinceTurnEnd: NUMBER,
	msSinceSent: NUMBER,
	chars: NUMBER,
	runCount: NUMBER,
	beforeRunCount: NUMBER,
	candidateCount: NUMBER,
	filesEdited: NUMBER,
	latencyMs: NUMBER,
	excludedCount: NUMBER,
	exposedFirst: BOOLEAN,
	turnWasRunning: BOOLEAN,
	interleaved: BOOLEAN,
	beforeInput: BOOLEAN,
	toolErrored: BOOLEAN,
	fallback: BOOLEAN,
	reroll: BOOLEAN,
	excluded: { kind: "tokens", maxItems: EXCLUDED_LIMIT },
	candidateIds: { kind: "tokens", maxItems: EXCLUDED_LIMIT },
	kinds: { kind: "tokens", maxItems: EXCLUDED_LIMIT },
	sources: { kind: "tokens", maxItems: EXCLUDED_LIMIT },
	tags: { kind: "tokens", maxItems: LABEL_TAGS_MAX },
} as const satisfies Record<string, FieldSpec>;

type FieldValue<Spec> = Spec extends {
	kind: "enum";
	values: readonly (infer Value)[];
}
	? Value
	: Spec extends { kind: "number" }
		? number
		: Spec extends { kind: "boolean" }
			? boolean
			: Spec extends { kind: "tokens" }
				? readonly string[]
				: string;

/** What a label may carry besides its header; `typedText` is hashed before anything is written. */
export type LabelFields = {
	[Field in keyof typeof LABEL_FIELDS]?: FieldValue<
		(typeof LABEL_FIELDS)[Field]
	>;
} & { typedText?: string };

const RECORD_KEYS: ReadonlySet<string> = new Set([
	"v",
	"at",
	"sessionId",
	"event",
	"typedText",
	...Object.keys(LABEL_FIELDS),
]);

/**
 * The order the writer emits fields in. Label lines keep the layout they have
 * always had: `messageHash` and `bucket`, then the token lists, then every
 * other field in the published schema's order.
 */
function writeGroup(field: string, spec: FieldSpec): number {
	if (field === "messageHash" || field === "bucket") return 0;
	return spec.kind === "tokens" ? 1 : 2;
}

const WRITE_ORDER = (
	Object.entries(LABEL_FIELDS) as [string, FieldSpec][]
).sort(([a, specA], [b, specB]) => writeGroup(a, specA) - writeGroup(b, specB));

export type LabelRecord = {
	v: number;
	at: string;
	sessionId: string;
	event: LabelEvent;
} & Record<string, unknown>;

export function isToken(value: unknown): value is string {
	return typeof value === "string" && TOKEN_PATTERN.test(value);
}

function isLabelEvent(value: unknown): value is LabelEvent {
	return typeof value === "string" && LABEL_EVENT_SET.has(value);
}

function fieldProblem(spec: FieldSpec, value: unknown): string | undefined {
	switch (spec.kind) {
		case "token":
			return isToken(value) ? undefined : "must be a token";
		case "enum":
			return typeof value === "string" && spec.values.includes(value)
				? undefined
				: `must be one of ${spec.values.join(", ")}`;
		case "number":
			return typeof value === "number" && Number.isFinite(value)
				? undefined
				: "must be a finite number";
		case "boolean":
			return typeof value === "boolean" ? undefined : "must be a boolean";
		case "tokens":
			if (!Array.isArray(value) || value.length > spec.maxItems)
				return "must be a bounded array";
			return value.every(isToken) ? undefined : "items must be tokens";
		case "hex64":
			return typeof value === "string" && HEX64_PATTERN.test(value)
				? undefined
				: "must be 64 hex characters";
	}
}

/**
 * Validates one label record and returns the sanitized line: `typedText`
 * reduced to `messageHash` and `chars`, every other field checked against the
 * schema, any unknown key refused as the prose it would be. A named field
 * left undefined is not written. Throws on the first thing the schema does
 * not name.
 */
export function buildLabelRecord(record: unknown): LabelRecord {
	if (!isRecord(record)) throw new Error("the record must be an object");
	if (record.v !== LABEL_SCHEMA_VERSION)
		throw new Error(`v must be ${LABEL_SCHEMA_VERSION}`);
	if (typeof record.at !== "string" || Number.isNaN(Date.parse(record.at)))
		throw new Error("at must be a timestamp string");
	if (!isToken(record.sessionId)) throw new Error("sessionId must be a token");
	if (!isLabelEvent(record.event))
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
		const typed = record.typedText.slice(0, TYPED_TEXT_LIMIT);
		out.messageHash = sha256Hex(typed);
		out.chars = typed.length;
	}
	for (const [field, spec] of WRITE_ORDER) {
		const value = record[field];
		if (value === undefined) continue;
		const problem = fieldProblem(spec, value);
		if (problem) throw new Error(`${field} ${problem}`);
		out[field] = value;
	}
	for (const key of Object.keys(record))
		if (!RECORD_KEYS.has(key))
			throw new Error(`${key} is not a field the label schema names`);
	return out;
}

type LabelSubject = {
	sessionId: string;
	offerId?: string;
	setId?: string;
	turnKey?: string;
	runCount?: number;
};

export function labelHeader(
	event: LabelEvent,
	at: Date,
	subject: LabelSubject,
): LabelRecord {
	return {
		v: LABEL_SCHEMA_VERSION,
		at: at.toISOString(),
		sessionId: subject.sessionId,
		event,
		offerId: subject.offerId,
		setId: subject.setId,
		turnKey: subject.turnKey,
		runCount: subject.runCount,
	};
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
	planner: Planner;
};

type OfferFacts = {
	turn: TurnFacts;
	latencyMs: number;
	tags: readonly string[];
	at?: Date;
};

/**
 * The `offer` record for one served set: ids, kinds and sources in rank
 * order, the turn's facts, the manifest tags, how long it took. Never a prompt
 * or a why. A tag that is not a token (an MCP server name with a space) is
 * left out rather than failing the record.
 */
export function offerRecord(offer: Offer, facts: OfferFacts): LabelRecord {
	return {
		...labelHeader("offer", facts.at ?? new Date(), offer),
		runId: isToken(offer.runId) ? offer.runId : undefined,
		trigger: offer.trigger,
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
		fallback: false,
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

	append(raw: unknown): void {
		const record = buildLabelRecord(raw);
		appendJsonLine(this.path, record);
		this.mirror?.(record);
	}
}
