import { isRecord, num, text } from "../values";
import { isToken, type LabelEvent, type Offer, TOKEN_PATTERN } from "./labels";

/**
 * The tray slot's protocol: the set it shows, the sequenced state push, and
 * the actions it sends back through `plugin.invoke`. One table per action
 * gives the parser, the TypeScript type and the published
 * `NextTurnTrayAction` schema, so the three cannot disagree.
 */

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
type ModelStatus = (typeof MODEL_STATUSES)[number];

/** Label events the tray records itself, through the `label` action. */
const TRAY_PASSTHROUGH_LABEL_EVENTS = [
	"set_ready",
	"highlight_move",
	"key_inert",
	"refused_stale",
	"undo_adjust",
	"undo_turn",
	"lineage",
	"ignored",
] as const satisfies readonly LabelEvent[];
type TrayPassthroughLabelEvent = (typeof TRAY_PASSTHROUGH_LABEL_EVENTS)[number];

export type OfferedSet = Offer & {
	revision: string;
	rerollsLeft?: number;
	/** Set when the chat has used its planner allowance: the rules keep answering. */
	paused?: { resetsAt: number };
	model?: { status: ModelStatus; resetsAt?: number };
};

export type TrayPush = {
	sessionId: string;
	seq: number;
	state: TrayState;
	turnKey?: string;
	rerollsLeft?: number;
	set?: OfferedSet;
	error?: string;
};

/** One action field: how the published schema describes it, and how the parser reads it (undefined when refused). */
type Field<T> = {
	schema: Record<string, unknown>;
	read(value: unknown): T | undefined;
};

const id: Field<string> = {
	schema: { type: "string", minLength: 1 },
	read: text,
};
const token: Field<string> = {
	schema: { type: "string", pattern: TOKEN_PATTERN.source },
	read: (value) => (isToken(value) ? value : undefined),
};
const count: Field<number> = {
	schema: { type: "integer", minimum: 0 },
	read: (value) =>
		typeof value === "number" && Number.isInteger(value) && value >= 0
			? value
			: undefined,
};
const ms: Field<number> = { schema: { type: "number" }, read: num };
const chatScope: Field<"chat"> = {
	schema: { const: "chat" },
	read: (value) => (value === "chat" ? value : undefined),
};
const passthroughEvent: Field<TrayPassthroughLabelEvent> = {
	schema: { enum: [...TRAY_PASSTHROUGH_LABEL_EVENTS] },
	read: (value) =>
		TRAY_PASSTHROUGH_LABEL_EVENTS.find((event) => event === value),
};
const labelFields: Field<Record<string, unknown>> = {
	schema: { type: "object" },
	read: (value) => (isRecord(value) ? value : undefined),
};

type ActionFields = Readonly<Record<string, Field<unknown>>>;
type ActionSpec = { required: ActionFields; optional: ActionFields };

const candidateVerb = {
	required: { candidateId: id },
	optional: { offerId: id, input: token, msSinceExposed: ms },
} as const;

/** Every tray action and its fields, in the published schema's order. */
const TRAY_ACTIONS = {
	current: { required: {}, optional: { client: id, runCount: count } },
	skip: candidateVerb,
	unskip: {
		required: { candidateId: id },
		optional: { offerId: id, input: token },
	},
	use: candidateVerb,
	send: candidateVerb,
	reroll: {
		required: {},
		optional: { offerId: id, input: token, cause: token },
	},
	exposed: { required: {}, optional: { offerId: id, candidateId: id } },
	hide: { required: {}, optional: { scope: chatScope } },
	label: {
		required: { event: passthroughEvent },
		optional: { offerId: id, fields: labelFields },
	},
} as const satisfies Record<string, ActionSpec>;

type TrayActions = typeof TRAY_ACTIONS;
type ValueOf<F> = F extends Field<infer T> ? T : never;
type ActionOf<Type extends keyof TrayActions> = { type: Type } & {
	-readonly [Key in keyof TrayActions[Type]["required"]]: ValueOf<
		TrayActions[Type]["required"][Key]
	>;
} & {
	-readonly [Key in keyof TrayActions[Type]["optional"]]?: ValueOf<
		TrayActions[Type]["optional"][Key]
	>;
};

export type TrayAction = {
	[Type in keyof TrayActions]: ActionOf<Type>;
}[keyof TrayActions];

/** An incoming `plugin.invoke` payload, or null when `NextTurnTrayAction` refuses it. */
export function parseTrayAction(raw: unknown): TrayAction | null {
	if (
		!isRecord(raw) ||
		typeof raw.type !== "string" ||
		!Object.hasOwn(TRAY_ACTIONS, raw.type)
	)
		return null;
	const spec: ActionSpec = TRAY_ACTIONS[raw.type as keyof TrayActions];
	const fields = { ...spec.required, ...spec.optional };
	if (
		Object.keys(raw).some(
			(key) => key !== "type" && !Object.hasOwn(fields, key),
		)
	)
		return null;
	const action: Record<string, unknown> = { type: raw.type };
	for (const [key, field] of Object.entries(fields)) {
		if (raw[key] === undefined && !Object.hasOwn(spec.required, key)) continue;
		const value = field.read(raw[key]);
		if (value === undefined) return null;
		action[key] = value;
	}
	return action as TrayAction;
}

/** `NextTurnTrayAction`: one closed object per action. */
export function trayActionSchema(): Record<string, unknown> {
	return {
		oneOf: Object.entries(TRAY_ACTIONS).map(
			([type, spec]: [string, ActionSpec]) => ({
				type: "object",
				required: ["type", ...Object.keys(spec.required)],
				properties: {
					type: { const: type },
					...Object.fromEntries(
						Object.entries({ ...spec.required, ...spec.optional }).map(
							([key, field]) => [key, field.schema],
						),
					),
				},
				additionalProperties: false,
			}),
		),
	};
}
