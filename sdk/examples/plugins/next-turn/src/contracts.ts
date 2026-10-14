import { fileURLToPath } from "node:url";
import {
	CONTRACT_ID_BASE,
	CONTRACT_SCHEMA_DIALECT,
	EXCLUDED_LIMIT,
	LABEL_SCHEMA_VERSION,
	PROMPT_MAX_CHARS,
	REF_MAX_CHARS,
	REROLL_LIMIT,
	SET_SIZE,
	WHY_MAX_CHARS,
} from "./config";
import { SOURCE_STATES } from "./context/source";
import {
	CORE_KINDS,
	CUE_CODES,
	GATED_KINDS,
	SUGGESTION_SOURCES,
} from "./planner/candidates";
import {
	BOOLEAN_FIELDS,
	BUCKETS,
	LABEL_EVENTS,
	NUMBER_FIELDS,
	TOKEN_FIELDS,
	TOKEN_LIST_FIELDS,
	TOKEN_PATTERN,
	TRIGGERS,
} from "./planner/labels";

/**
 * What Next Turn publishes as JSON Schema (generated into `contracts/` by
 * `scripts/build-contracts.ts` in this package): the label record, the
 * environment manifest, and the UI slot's payloads (the set a tray shows, the
 * sequenced state push, and the actions it sends back through `plugin.invoke`).
 * Built from the same constants the writer and the engine use, so the schema
 * and the code cannot disagree. A host that renders the tray natively codes
 * against these.
 */

export { CONTRACT_ID_BASE, CONTRACT_SCHEMA_DIALECT };

/** This module, so the generated index can say where the schemas come from. */
export const CONTRACTS_MODULE = fileURLToPath(import.meta.url);

export type ContractSchema = {
	name: string;
	io: "input" | "output";
	about: string;
	schema: Record<string, unknown>;
};

export const TRAY_STATES = [
	"computing",
	"ready",
	"empty",
	"exhausted",
	"unavailable",
	"off",
] as const;
export type TrayState = (typeof TRAY_STATES)[number];

export const MODEL_STATUSES = [
	"pending",
	"no_provider",
	"error",
	"paused",
] as const;
export type ModelStatus = (typeof MODEL_STATUSES)[number];

export const TRAY_PASSTHROUGH_LABEL_EVENTS = [
	"set_ready",
	"highlight_move",
	"key_inert",
	"refused_stale",
	"undo_adjust",
	"undo_turn",
	"lineage",
	"ignored",
] as const;
export type TrayPassthroughLabelEvent =
	(typeof TRAY_PASSTHROUGH_LABEL_EVENTS)[number];

const token = { type: "string", pattern: TOKEN_PATTERN.source };
const count = { type: "integer", minimum: 0 };

function labelRecordSchema(): Record<string, unknown> {
	const properties: Record<string, unknown> = {
		v: { const: LABEL_SCHEMA_VERSION },
		at: { type: "string", format: "date-time" },
		sessionId: token,
		event: { enum: [...LABEL_EVENTS] },
		messageHash: {
			type: "string",
			pattern: "^[0-9a-f]{64}$",
			description:
				"sha256 of what the person typed; the text itself is never written",
		},
		bucket: { enum: [...BUCKETS] },
	};
	for (const field of TOKEN_FIELDS)
		properties[field] = field === "trigger" ? { enum: [...TRIGGERS] } : token;
	for (const field of NUMBER_FIELDS) properties[field] = { type: "number" };
	for (const field of BOOLEAN_FIELDS) properties[field] = { type: "boolean" };
	for (const [field, bound] of Object.entries(TOKEN_LIST_FIELDS))
		properties[field] = { type: "array", items: token, maxItems: bound };
	return {
		type: "object",
		required: ["v", "at", "sessionId", "event"],
		properties,
		additionalProperties: false,
	};
}

const suggestionSchema = {
	type: "object",
	required: ["id", "kind", "source", "prompt", "why"],
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
	},
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
	],
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
		planner: { enum: ["rules", "model"] },
		revision: { type: "string" },
		rerollsLeft: { type: "integer", minimum: 0, maximum: REROLL_LIMIT },
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
	},
	additionalProperties: false,
};

const candidateVerbProperties = {
	candidateId: { type: "string" },
	offerId: { type: "string" },
	input: token,
	msSinceExposed: { type: "number" },
};

export const NEXT_TURN_SCHEMAS: readonly ContractSchema[] = [
	{
		name: "NextTurnLabelRecord",
		io: "output",
		about:
			"One line of the label log (schema v3: v2 plus manifest tags). Ids, kinds and numbers only, never prose",
		schema: labelRecordSchema(),
	},
	{
		name: "NextTurnManifest",
		io: "output",
		about:
			"The environment manifest: each source's state and the capabilities the planner may name",
		schema: {
			type: "object",
			required: ["sources", "capabilities"],
			properties: {
				client: { type: "string" },
				mode: { enum: ["act", "plan"] },
				sources: {
					type: "object",
					additionalProperties: { enum: [...SOURCE_STATES] },
				},
				capabilities: { type: "array", items: { type: "string" } },
			},
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
			required: ["sessionId", "seq", "state"],
			properties: {
				sessionId: { type: "string" },
				seq: count,
				state: { enum: [...TRAY_STATES] },
				turnKey: { type: "string" },
				rerollsLeft: { type: "integer", minimum: 0, maximum: REROLL_LIMIT },
				set: setSchema,
				error: { type: "string" },
			},
			additionalProperties: false,
		},
	},
	{
		name: "NextTurnTrayAction",
		io: "input",
		about: "What the tray slot sends back through plugin.invoke",
		schema: {
			oneOf: [
				{
					type: "object",
					required: ["type"],
					properties: {
						type: { const: "current" },
						client: { type: "string" },
						runCount: count,
					},
					additionalProperties: false,
				},
				{
					type: "object",
					required: ["type", "candidateId"],
					properties: { type: { const: "skip" }, ...candidateVerbProperties },
					additionalProperties: false,
				},
				{
					type: "object",
					required: ["type", "candidateId"],
					properties: {
						type: { const: "unskip" },
						candidateId: { type: "string" },
						offerId: { type: "string" },
						input: token,
					},
					additionalProperties: false,
				},
				{
					type: "object",
					required: ["type", "candidateId"],
					properties: { type: { const: "use" }, ...candidateVerbProperties },
					additionalProperties: false,
				},
				{
					type: "object",
					required: ["type", "candidateId"],
					properties: { type: { const: "send" }, ...candidateVerbProperties },
					additionalProperties: false,
				},
				{
					type: "object",
					required: ["type"],
					properties: {
						type: { const: "reroll" },
						offerId: { type: "string" },
						input: token,
						cause: token,
					},
					additionalProperties: false,
				},
				{
					type: "object",
					required: ["type"],
					properties: {
						type: { const: "exposed" },
						offerId: { type: "string" },
						candidateId: { type: "string" },
					},
					additionalProperties: false,
				},
				{
					type: "object",
					required: ["type"],
					properties: { type: { const: "hide" }, scope: { const: "chat" } },
					additionalProperties: false,
				},
				{
					type: "object",
					required: ["type", "event"],
					properties: {
						type: { const: "label" },
						event: { enum: [...TRAY_PASSTHROUGH_LABEL_EVENTS] },
						offerId: { type: "string" },
						fields: { type: "object" },
					},
					additionalProperties: false,
				},
			],
		},
	},
];
