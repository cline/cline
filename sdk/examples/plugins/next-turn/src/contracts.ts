import {
	EXCLUDED_LIMIT,
	LABEL_SCHEMA_VERSION,
	PROMPT_MAX_CHARS,
	REF_MAX_CHARS,
	REROLL_LIMIT,
	SET_SIZE,
	WHY_MAX_CHARS,
} from "./config";
import type { Manifest } from "./context/manifest";
import { CHAT_MODES, SOURCE_STATES } from "./context/source";
import {
	CUE_CODES,
	SUGGESTION_SOURCES,
	type Suggestion,
} from "./planner/candidates";
import { CORE_KINDS, GATED_KINDS } from "./planner/kinds";
import {
	type FieldSpec,
	HEX64_PATTERN,
	LABEL_EVENTS,
	LABEL_FIELDS,
	PLANNERS,
	TOKEN_PATTERN,
	TRIGGERS,
} from "./planner/labels";
import {
	MODEL_STATUSES,
	type OfferedSet,
	TRAY_STATES,
	type TrayPush,
	trayActionSchema,
} from "./planner/tray";

/**
 * What Next Turn publishes as JSON Schema (generated into `contracts/` by
 * `scripts/build-contracts.ts` in this package): the label record, the
 * environment manifest, and the UI slot's payloads (the set a tray shows, the
 * sequenced state push, and the actions it sends back through `plugin.invoke`).
 * Built from the constants the writer and the engine use, and each object's
 * `properties` names exactly its type's keys. A host that renders the tray
 * natively codes against these.
 */

type ContractSchema = {
	name: string;
	io: "input" | "output";
	about: string;
	schema: Record<string, unknown>;
};

/** The keys `T` cannot leave out: what a schema's `required` may list. */
type RequiredKeys<T> = {
	[Key in keyof T]-?: object extends Pick<T, Key> ? never : Key;
}[keyof T];

const token = { type: "string", pattern: TOKEN_PATTERN.source };
const count = { type: "integer", minimum: 0 };
const rerollsLeft = { type: "integer", minimum: 0, maximum: REROLL_LIMIT };

function fieldSchema(spec: FieldSpec): Record<string, unknown> {
	switch (spec.kind) {
		case "token":
			return token;
		case "enum":
			return { enum: [...spec.values] };
		case "number":
		case "boolean":
			return { type: spec.kind };
		case "tokens":
			return { type: "array", items: token, maxItems: spec.maxItems };
		case "hex64":
			return {
				type: "string",
				pattern: HEX64_PATTERN.source,
				description: spec.description,
			};
	}
}

function labelRecordSchema(): Record<string, unknown> {
	const properties: Record<string, unknown> = {
		v: { const: LABEL_SCHEMA_VERSION },
		at: { type: "string", format: "date-time" },
		sessionId: token,
		event: { enum: [...LABEL_EVENTS] },
	};
	for (const [field, spec] of Object.entries(LABEL_FIELDS))
		properties[field] = fieldSchema(spec);
	return {
		type: "object",
		required: ["v", "at", "sessionId", "event"],
		properties,
		additionalProperties: false,
	};
}

const suggestionSchema = {
	type: "object",
	required: [
		"id",
		"kind",
		"source",
		"prompt",
		"why",
	] satisfies readonly RequiredKeys<Suggestion>[],
	properties: {
		id: { type: "string", pattern: "^[0-9a-f]{8}$" },
		kind: { enum: [...CORE_KINDS, ...GATED_KINDS] },
		source: { enum: [...SUGGESTION_SOURCES] },
		prompt: { type: "string", maxLength: PROMPT_MAX_CHARS },
		why: { type: "string", maxLength: WHY_MAX_CHARS },
		ref: { type: "string", maxLength: REF_MAX_CHARS },
		url: { type: "string" },
		outward: {
			const: true,
			description:
				"Posts or comments outside the machine: offer Use only, never Send",
		},
	} satisfies Record<keyof Suggestion, unknown>,
	additionalProperties: false,
};

const setSchema = {
	type: "object",
	required: [
		"sessionId",
		"offerId",
		"setId",
		"turnKey",
		"runCount",
		"cueCode",
		"candidates",
		"excluded",
		"planner",
		"revision",
	] satisfies readonly RequiredKeys<OfferedSet>[],
	properties: {
		sessionId: { type: "string" },
		offerId: { type: "string" },
		setId: { type: "string" },
		turnKey: { type: "string" },
		runCount: count,
		runId: { type: "string" },
		trigger: { enum: [...TRIGGERS] },
		cueCode: { enum: [...CUE_CODES] },
		candidates: { type: "array", items: suggestionSchema, maxItems: SET_SIZE },
		excluded: {
			type: "array",
			items: { type: "string" },
			maxItems: EXCLUDED_LIMIT,
		},
		planner: { enum: [...PLANNERS] },
		revision: { type: "string" },
		rerollsLeft,
		paused: {
			type: "object",
			required: ["resetsAt"],
			properties: { resetsAt: { type: "number" } },
			additionalProperties: false,
		},
		model: {
			type: "object",
			required: ["status"],
			properties: {
				status: { enum: [...MODEL_STATUSES] },
				resetsAt: { type: "number" },
			},
			additionalProperties: false,
		},
	} satisfies Record<keyof OfferedSet, unknown>,
	additionalProperties: false,
};

export const NEXT_TURN_SCHEMAS: readonly ContractSchema[] = [
	{
		name: "NextTurnLabelRecord",
		io: "output",
		about: `One line of the label log (schema v${LABEL_SCHEMA_VERSION}). Ids, kinds and numbers only, never prose`,
		schema: labelRecordSchema(),
	},
	{
		name: "NextTurnManifest",
		io: "output",
		about:
			"The environment manifest: each source's state and the capabilities the planner may name",
		schema: {
			type: "object",
			required: [
				"sources",
				"capabilities",
			] satisfies readonly RequiredKeys<Manifest>[],
			properties: {
				client: { type: "string" },
				mode: { enum: [...CHAT_MODES] },
				sources: {
					type: "object",
					additionalProperties: { enum: [...SOURCE_STATES] },
				},
				capabilities: { type: "array", items: { type: "string" } },
			} satisfies Record<keyof Manifest, unknown>,
			additionalProperties: false,
		},
	},
	{
		name: "NextTurnSet",
		io: "output",
		about:
			"The set the tray slot shows: one served offer, rules first and the model's when it answers",
		schema: setSchema,
	},
	{
		name: "NextTurnTrayPush",
		io: "output",
		about:
			"A sequenced tray state update pushed on next.state or returned from current",
		schema: {
			type: "object",
			required: [
				"sessionId",
				"seq",
				"state",
			] satisfies readonly RequiredKeys<TrayPush>[],
			properties: {
				sessionId: { type: "string" },
				seq: count,
				state: { enum: [...TRAY_STATES] },
				turnKey: { type: "string" },
				rerollsLeft,
				set: setSchema,
				error: { type: "string" },
			} satisfies Record<keyof TrayPush, unknown>,
			additionalProperties: false,
		},
	},
	{
		name: "NextTurnTrayAction",
		io: "input",
		about: "What the tray slot sends back through plugin.invoke",
		schema: trayActionSchema(),
	},
];
