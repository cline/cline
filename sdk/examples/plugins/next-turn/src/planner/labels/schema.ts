import { EXCLUDED_LIMIT, LABEL_TAGS_MAX } from "../../config";

/**
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

/** Short machine tokens: no spaces, a bounded charset, 64 chars at most. Upstream's `runId` is mixed-case base62. */
export const TOKEN_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,63}$/;
export const HEX64_PATTERN = /^[0-9a-f]{64}$/;
const BUCKETS = ["same", "small", "large"] as const;
export type Bucket = (typeof BUCKETS)[number];

export const TRIGGERS = ["after_run", "on_demand"] as const;
export type OfferTrigger = (typeof TRIGGERS)[number];

export const PLANNERS = ["rules", "model"] as const;
export type Planner = (typeof PLANNERS)[number];

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

export type LabelRecord = {
	v: number;
	at: string;
	sessionId: string;
	event: LabelEvent;
} & Record<string, unknown>;

export function isToken(value: unknown): value is string {
	return typeof value === "string" && TOKEN_PATTERN.test(value);
}
