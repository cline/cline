import { z } from "zod";
import {
	PLUGIN_UI_COMMAND,
	PLUGIN_UI_ICONS,
	PLUGIN_UI_LIMITS,
	PLUGIN_UI_TOKEN,
	PLUGIN_UI_TONES,
	type PluginUiSlot,
	type PluginUiTone,
} from "../constants";
import type {
	ComposerSuggestionItem,
	ComposerSuggestionsHiddenReason,
	ComposerSuggestionsState,
	ComposerSuggestionsStatus,
	PluginUiState,
} from "../contracts";
import {
	exceedsUtf8Bytes,
	isOneOf,
	isPluginUiSlot,
	toPlainJson,
} from "./guards";
import { clampPluginUiText } from "./text";

export type PluginUiDropReason =
	| "unknown_slot"
	| "unserializable"
	| "too_large"
	| "invalid"
	| "not_owner"
	| "stale_epoch"
	| "unregistered";

export type PluginUiStateNormalization =
	| { ok: true; slot: PluginUiSlot; state: PluginUiState | null }
	| { ok: false; reason: PluginUiDropReason };

const LINK_PROTOCOLS: ReadonlySet<string> = new Set(["http:", "https:"]);
const STATUSES = [
	"loading",
	"ready",
	"empty",
	"exhausted",
	"unavailable",
	"hidden",
] as const satisfies readonly ComposerSuggestionsStatus[];
const HIDDEN_REASONS = [
	"superseded",
	"user",
	"disabled",
] as const satisfies readonly ComposerSuggestionsHiddenReason[];

function readHttpUrl(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		return undefined;
	}
	if (!LINK_PROTOCOLS.has(parsed.protocol)) return undefined;
	if (parsed.username || parsed.password) return undefined;
	return parsed.href.length <= PLUGIN_UI_LIMITS.urlChars
		? parsed.href
		: undefined;
}

const rawItemSchema = z.object({
	id: z.string(),
	label: z.string(),
	tone: z.unknown(),
	icon: z.unknown().optional(),
	prompt: z.string(),
	detail: z.string().optional(),
	source: z
		.object({ label: z.string(), url: z.unknown().optional() })
		.optional(),
	sendable: z.boolean().default(false),
});

const rawComposerSuggestionsSchema = z.object({
	status: z.unknown(),
	title: z.string(),
	command: z.unknown().optional(),
	cue: z.object({ text: z.string(), tone: z.unknown() }).optional(),
	note: z.string().optional(),
	hiddenReason: z.unknown().optional(),
	revision: z.string(),
	items: z.array(z.unknown()).default([]),
	canRefresh: z.boolean().default(false),
});

function readTone(value: unknown): PluginUiTone {
	return isOneOf(PLUGIN_UI_TONES, value) ? value : "neutral";
}

function normalizeSource(
	source: z.infer<typeof rawItemSchema>["source"],
): ComposerSuggestionItem["source"] {
	if (!source) return undefined;
	const label = clampPluginUiText(
		source.label,
		PLUGIN_UI_LIMITS.sourceLabelChars,
	);
	if (!label) return undefined;
	const url = readHttpUrl(source.url);
	return url ? { label, url } : { label };
}

/** Normalizes one raw item; undefined drops it. */
function normalizeComposerSuggestionItem(
	value: unknown,
): ComposerSuggestionItem | undefined {
	const parsed = rawItemSchema.safeParse(value);
	if (!parsed.success) return undefined;
	const raw = parsed.data;
	if (!PLUGIN_UI_TOKEN.test(raw.id)) return undefined;
	const label = clampPluginUiText(raw.label, PLUGIN_UI_LIMITS.labelChars);
	const prompt = clampPluginUiText(raw.prompt, PLUGIN_UI_LIMITS.promptChars, {
		multiline: true,
	});
	if (!label || !prompt || prompt.startsWith("/")) return undefined;
	const detail =
		raw.detail === undefined
			? ""
			: clampPluginUiText(raw.detail, PLUGIN_UI_LIMITS.detailChars);
	const source = normalizeSource(raw.source);
	return {
		id: raw.id,
		label,
		tone: readTone(raw.tone),
		...(isOneOf(PLUGIN_UI_ICONS, raw.icon) ? { icon: raw.icon } : {}),
		prompt,
		...(detail ? { detail } : {}),
		...(source ? { source } : {}),
		sendable: raw.sendable,
	};
}

/** Keeps the first item per id, then cuts to the visible limit. */
function selectComposerSuggestionItems(
	rawItems: readonly unknown[],
): ComposerSuggestionItem[] {
	const items: ComposerSuggestionItem[] = [];
	const seen = new Set<string>();
	for (const raw of rawItems.slice(0, PLUGIN_UI_LIMITS.rawItems)) {
		const item = normalizeComposerSuggestionItem(raw);
		if (!item || seen.has(item.id)) continue;
		seen.add(item.id);
		items.push(item);
	}
	return items.slice(0, PLUGIN_UI_LIMITS.items);
}

function normalizeComposerSuggestionsState(
	value: unknown,
): ComposerSuggestionsState | undefined {
	const parsed = rawComposerSuggestionsSchema.safeParse(value);
	if (!parsed.success) return undefined;
	const raw = parsed.data;
	if (!PLUGIN_UI_TOKEN.test(raw.revision)) return undefined;
	const title = clampPluginUiText(raw.title, PLUGIN_UI_LIMITS.titleChars);
	if (!title) return undefined;
	const items = selectComposerSuggestionItems(raw.items);
	const declared = isOneOf(STATUSES, raw.status) ? raw.status : "hidden";
	const status =
		declared === "ready" && items.length === 0 ? "empty" : declared;
	const command =
		typeof raw.command === "string" && PLUGIN_UI_COMMAND.test(raw.command)
			? raw.command
			: undefined;
	const cueText = raw.cue
		? clampPluginUiText(raw.cue.text, PLUGIN_UI_LIMITS.cueChars)
		: "";
	const note =
		raw.note === undefined
			? ""
			: clampPluginUiText(raw.note, PLUGIN_UI_LIMITS.noteChars);
	const hiddenReason =
		status === "hidden" && isOneOf(HIDDEN_REASONS, raw.hiddenReason)
			? raw.hiddenReason
			: undefined;
	return {
		status,
		title,
		...(command ? { command } : {}),
		...(cueText
			? { cue: { text: cueText, tone: readTone(raw.cue?.tone) } }
			: {}),
		...(note ? { note } : {}),
		...(hiddenReason ? { hiddenReason } : {}),
		revision: raw.revision,
		items,
		canRefresh: raw.canRefresh,
	};
}

const STATE_NORMALIZERS: {
	[S in PluginUiSlot]: (value: unknown) => PluginUiState<S> | undefined;
} = {
	"composer.suggestions": normalizeComposerSuggestionsState,
};

/**
 * Normalizes one slot state for storing, emitting or rendering. A `null`
 * value clears the slot. Idempotent: a normalized state comes back unchanged.
 */
export function normalizePluginUiState(
	slot: unknown,
	value: unknown,
): PluginUiStateNormalization {
	if (!isPluginUiSlot(slot)) return { ok: false, reason: "unknown_slot" };
	if (value === null) return { ok: true, slot, state: null };
	const plain = toPlainJson(value, PLUGIN_UI_LIMITS.workerStateBytes);
	if (!plain.ok) return plain;
	const state = STATE_NORMALIZERS[slot](plain.value);
	if (!state) return { ok: false, reason: "invalid" };
	if (exceedsUtf8Bytes(JSON.stringify(state), PLUGIN_UI_LIMITS.stateBytes))
		return { ok: false, reason: "too_large" };
	return { ok: true, slot, state };
}
