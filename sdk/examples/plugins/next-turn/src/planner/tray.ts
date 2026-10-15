import { type LabelEvent, type Offer, TOKEN_PATTERN } from "./labels";

/**
 * Next's own tray state: the set it shows, the sequenced state push, and the
 * actions that drive it. Cline's `composer.suggestions` slot is projected
 * from these (`tray-view.ts`), and its verbs map onto these actions. One
 * table per action gives the TypeScript type and the published
 * `NextTurnTrayAction` schema, so the two cannot disagree.
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

export const OFF_REASONS = ["message", "hidden", "disabled"] as const;
/** Why the tray went off: a message superseded the set (or no set exists yet), the person hid this chat's, or Next or the plugin is off. */
export type OffReason = (typeof OFF_REASONS)[number];

export const COMPUTING_FOR = ["turn", "reroll"] as const;
/** What a `computing` push is working on: the turn's first set, or a reroll the planner must answer. */
export type ComputingFor = (typeof COMPUTING_FOR)[number];

export type TrayPush = {
	sessionId: string;
	seq: number;
	state: TrayState;
	turnKey?: string;
	rerollsLeft?: number;
	set?: OfferedSet;
	error?: string;
	offReason?: OffReason;
	computingFor?: ComputingFor;
};

/** One action field as the published schema describes it; `T` is the value it carries. */
type Field<T> = { schema: Record<string, unknown>; value?: T };

const id: Field<string> = { schema: { type: "string", minLength: 1 } };
const token: Field<string> = {
	schema: { type: "string", pattern: TOKEN_PATTERN.source },
};
const ms: Field<number> = { schema: { type: "number" } };
const chatScope: Field<"chat"> = { schema: { const: "chat" } };
const passthroughEvent: Field<TrayPassthroughLabelEvent> = {
	schema: { enum: [...TRAY_PASSTHROUGH_LABEL_EVENTS] },
};
const labelFields: Field<Record<string, unknown>> = {
	schema: { type: "object" },
};

type ActionFields = Readonly<Record<string, Field<unknown>>>;
type ActionSpec = { required: ActionFields; optional: ActionFields };

const candidateVerb = {
	required: { candidateId: id },
	optional: { offerId: id, input: token, msSinceExposed: ms },
} as const;

/** Every tray action and its fields, in the published schema's order. */
const TRAY_ACTIONS = {
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
