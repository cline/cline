import { z } from "zod";
import {
	PLUGIN_UI_INPUTS,
	PLUGIN_UI_LIMITS,
	PLUGIN_UI_SURFACES,
	PLUGIN_UI_TOKEN,
	type PluginUiSlot,
} from "../constants";
import type {
	ComposerSuggestionsAction,
	PluginUiAction,
	PluginUiPresenceAction,
} from "../contracts";
import { isPluginUiSlot, toPlainJson } from "./guards";

export type PluginUiActionParse =
	| { ok: true; slot: PluginUiSlot; action: PluginUiAction }
	| { ok: false; reason: "unknown_slot" | "too_large" | "invalid" };

const tokenSchema = z.string().regex(PLUGIN_UI_TOKEN);
const inputSchema = z.enum(PLUGIN_UI_INPUTS);
const msSinceExposedSchema = z.number().int().min(0).max(86_400_000);
const itemRefShape = { revision: tokenSchema, itemId: tokenSchema };

const PRESENCE_ACTION_SCHEMAS: Record<
	PluginUiPresenceAction["verb"],
	z.ZodType<PluginUiPresenceAction>
> = {
	attach: z.object({
		verb: z.literal("attach"),
		surface: z.enum(PLUGIN_UI_SURFACES),
	}),
	detach: z.object({ verb: z.literal("detach") }),
};

type ComposerSuggestionsVerb = Exclude<
	ComposerSuggestionsAction["verb"],
	PluginUiPresenceAction["verb"]
>;

const COMPOSER_SUGGESTIONS_ACTION_SCHEMAS: Record<
	ComposerSuggestionsVerb,
	z.ZodType<ComposerSuggestionsAction>
> = {
	exposed: z.object({
		verb: z.literal("exposed"),
		revision: tokenSchema,
		itemIds: z.array(tokenSchema).max(PLUGIN_UI_LIMITS.items),
	}),
	use: z.object({
		verb: z.literal("use"),
		input: inputSchema,
		msSinceExposed: msSinceExposedSchema.optional(),
		...itemRefShape,
	}),
	send: z.object({
		verb: z.literal("send"),
		input: inputSchema,
		msSinceExposed: msSinceExposedSchema.optional(),
		...itemRefShape,
	}),
	skip: z.object({
		verb: z.literal("skip"),
		input: inputSchema,
		msSinceExposed: msSinceExposedSchema.optional(),
		...itemRefShape,
	}),
	unskip: z.object({
		verb: z.literal("unskip"),
		input: inputSchema,
		...itemRefShape,
	}),
	clear: z.object({ verb: z.literal("clear"), ...itemRefShape }),
	undo: z.object({ verb: z.literal("undo"), ...itemRefShape }),
	refresh: z.object({
		verb: z.literal("refresh"),
		revision: tokenSchema,
		input: inputSchema,
		cause: z.enum(["more", "new_set"]),
	}),
	hide: z.object({
		verb: z.literal("hide"),
		scope: z.enum(["turn", "chat"]),
		input: inputSchema,
		revision: tokenSchema.optional(),
	}),
	show: z.object({ verb: z.literal("show"), input: inputSchema }),
	signal: z.object({
		verb: z.literal("signal"),
		name: z.literal("key_inert"),
		reason: z.enum(["not_exposed", "unsendable", "stale"]),
		revision: tokenSchema.optional(),
	}),
};

const SLOT_ACTION_SCHEMAS: {
	[S in PluginUiSlot]: Readonly<Record<string, z.ZodType<PluginUiAction<S>>>>;
} = {
	"composer.suggestions": COMPOSER_SUGGESTIONS_ACTION_SCHEMAS,
};

function actionSchemaFor(
	slot: PluginUiSlot,
	verb: unknown,
): z.ZodType<PluginUiAction> | undefined {
	if (typeof verb !== "string") return undefined;
	if (Object.hasOwn(PRESENCE_ACTION_SCHEMAS, verb))
		return PRESENCE_ACTION_SCHEMAS[verb as PluginUiPresenceAction["verb"]];
	const slotSchemas = SLOT_ACTION_SCHEMAS[slot];
	return Object.hasOwn(slotSchemas, verb) ? slotSchemas[verb] : undefined;
}

/** Validates a host's verb for a slot before any plugin sees it. Unknown keys are stripped. */
export function parsePluginUiAction(
	slot: unknown,
	value: unknown,
): PluginUiActionParse {
	if (!isPluginUiSlot(slot)) return { ok: false, reason: "unknown_slot" };
	const plain = toPlainJson(value, PLUGIN_UI_LIMITS.actionBytes);
	if (!plain.ok)
		return {
			ok: false,
			reason: plain.reason === "too_large" ? "too_large" : "invalid",
		};
	if (typeof plain.value !== "object" || plain.value === null)
		return { ok: false, reason: "invalid" };
	const schema = actionSchemaFor(
		slot,
		(plain.value as { verb?: unknown }).verb,
	);
	const parsed = schema?.safeParse(plain.value);
	if (!parsed?.success) return { ok: false, reason: "invalid" };
	return { ok: true, slot, action: parsed.data };
}
