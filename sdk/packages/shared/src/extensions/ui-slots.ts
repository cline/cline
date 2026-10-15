import { z } from "zod";
import { sanitizeSurrogates } from "../llms/ai-sdk-format";

export const PLUGIN_UI_SLOTS = ["composer.suggestions"] as const;
export type PluginUiSlot = (typeof PLUGIN_UI_SLOTS)[number];

export const PLUGIN_UI_TONES = [
	"repair",
	"check",
	"look",
	"continue",
	"decide",
	"finish",
	"neutral",
] as const;
export type PluginUiTone = (typeof PLUGIN_UI_TONES)[number];

/** Cline-owned meanings. Each host maps them to its own glyphs (lucide, codicons; none in a terminal). */
export const PLUGIN_UI_ICONS = [
	"fix",
	"retry",
	"verify",
	"review",
	"explain",
	"resume",
	"next",
	"plan",
	"answer",
	"reply",
	"commit",
	"wrap_up",
	"ci",
	"issue",
	"announce",
	"link",
] as const;
export type PluginUiIcon = (typeof PLUGIN_UI_ICONS)[number];

export const PLUGIN_UI_SURFACES = [
	"cli",
	"vscode",
	"jetbrains",
	"desktop",
	"other",
] as const;
export type PluginUiSurface = (typeof PLUGIN_UI_SURFACES)[number];

export const PLUGIN_UI_INPUTS = ["key", "pointer", "command"] as const;
export type PluginUiInput = (typeof PLUGIN_UI_INPUTS)[number];

/** ids, revisions */
export const PLUGIN_UI_TOKEN = /^[A-Za-z0-9._:-]{1,64}$/;
/** CLI host-local command name */
export const PLUGIN_UI_COMMAND = /^[a-z][a-z0-9-]{1,15}$/;

export const PLUGIN_UI_LIMITS = {
	/** UTF-8 bytes of the normalized state; the clamped worst case is about 35 KB. */
	stateBytes: 48 * 1024,
	/** Raw size: the worker drops anything larger before posting; core checks it again before clamping. */
	workerStateBytes: 64 * 1024,
	actionBytes: 2 * 1024,
	/** Raw entries read; the item filters run on these, then `items` cuts. */
	rawItems: 10,
	items: 3,
	titleChars: 16,
	cueChars: 80,
	noteChars: 160,
	labelChars: 16,
	promptChars: 2_000,
	detailChars: 240,
	sourceLabelChars: 32,
	urlChars: 2_048,
	/** Leading and trailing throttle per (session, slot). */
	pushIntervalMs: 100,
	/** Core's own bound in every plugin mode: arrival to `onAction`, and `onAction` itself. */
	invokeTimeoutMs: 10_000,
	/** Token bucket per session. */
	invokesPerSecond: 10,
	invokeBurst: 20,
	/** Teardown waits this long for an in-flight invoke. */
	closeWaitMs: 2_000,
} as const;

// ── composer.suggestions state ─────────────────────────────────────────────

export interface ComposerSuggestionItem {
	/** Stable within a revision; echoed by item verbs. PLUGIN_UI_TOKEN. */
	id: string;
	/** The word, e.g. "Fix". Always shown. */
	label: string;
	tone: PluginUiTone;
	icon?: PluginUiIcon;
	/** What Use writes into the box and Send submits. May contain "\n"; never starts with "/". */
	prompt: string;
	/** The why line. Single line. */
	detail?: string;
	/** Plain label; `url` is http(s) only and opened by the host's own safe opener. */
	source?: { label: string; url?: string };
	/** false = Use only. Hosts hide Send and the plugin refuses a `send`. */
	sendable: boolean;
}

export type ComposerSuggestionsStatus =
	| "loading"
	| "ready"
	| "empty"
	| "exhausted"
	| "unavailable"
	| "hidden";

export type ComposerSuggestionsHiddenReason =
	| "superseded"
	| "user"
	| "disabled";

export interface ComposerSuggestionsState {
	status: ComposerSuggestionsStatus;
	/** Header word, e.g. "Next". */
	title: string;
	/** CLI host-local command name, e.g. "next" -> "/next". PLUGIN_UI_COMMAND. */
	command?: string;
	/** "after a command failed", "reading the last turn…". */
	cue?: { text: string; tone: PluginUiTone };
	/** One muted line: unavailable copy, or a degraded planner. Never internal error text. */
	note?: string;
	/**
	 * Kept only when status is "hidden". "superseded" lets hosts keep their "sent" line;
	 * "user" means hidden for this chat, which `show` undoes.
	 */
	hiddenReason?: ComposerSuggestionsHiddenReason;
	/** Opaque id of this set; echoed by verbs so a stale key sends nothing. PLUGIN_UI_TOKEN. Required in every status. */
	revision: string;
	items: ComposerSuggestionItem[];
	/** A new set is available ("more" on the last row, New set). */
	canRefresh: boolean;
}

// ── verbs (host -> plugin) ─────────────────────────────────────────────────

/** Presence, shared by every slot. Core records the viewer before forwarding. */
export type PluginUiPresenceAction =
	| { verb: "attach"; surface: PluginUiSurface }
	| { verb: "detach" };

type ItemRef = { revision: string; itemId: string };

export type ComposerSuggestionsAction =
	| PluginUiPresenceAction
	/** At least 400 ms visible while ready, once per (viewer, revision). */
	| { verb: "exposed"; revision: string; itemIds: string[] }
	| ({
			verb: "use" | "send";
			input: PluginUiInput;
			msSinceExposed?: number;
	  } & ItemRef)
	| ({ verb: "skip"; input: PluginUiInput; msSinceExposed?: number } & ItemRef)
	/** Desktop More menu only. */
	| ({ verb: "unskip"; input: PluginUiInput } & ItemRef)
	/** The host emptied a used box, or is rewinding a sent turn. */
	| ({ verb: "clear" | "undo" } & ItemRef)
	| {
			verb: "refresh";
			revision: string;
			input: PluginUiInput;
			cause: "more" | "new_set";
	  }
	| {
			verb: "hide";
			scope: "turn" | "chat";
			input: PluginUiInput;
			revision?: string;
	  }
	/** Undoes `hide { scope: "chat" }`. */
	| { verb: "show"; input: PluginUiInput }
	| {
			verb: "signal";
			name: "key_inert";
			reason: "not_exposed" | "unsendable" | "stale";
			revision?: string;
	  };

export interface PluginUiSlotContracts {
	"composer.suggestions": {
		state: ComposerSuggestionsState;
		action: ComposerSuggestionsAction;
	};
}
export type PluginUiState<S extends PluginUiSlot = PluginUiSlot> =
	PluginUiSlotContracts[S]["state"];
export type PluginUiAction<S extends PluginUiSlot = PluginUiSlot> =
	PluginUiSlotContracts[S]["action"];

// ── envelope and ordering ──────────────────────────────────────────────────

/** The only shape that leaves core. Same object on CoreSessionEvent, the hub event, and get/invoke replies. */
export interface PluginUiStateEnvelope<S extends PluginUiSlot = PluginUiSlot> {
	/** The only sessionId. Never nested in state, so session remappers rewrite one field. */
	sessionId: string;
	slot: S;
	/** Owner plugin, stamped by the host from the worker's descriptor. Never from the payload. */
	plugin: string;
	/** Minted when the session starts: max(Date.now(), this session id's last epoch + 1). */
	epoch: number;
	/** 1.. per (session, slot) within the epoch; stamped when the state is stored. */
	seq: number;
	/** Normalized. null = cleared (plugin cleared it, failed, or was disabled). */
	state: PluginUiState<S> | null;
}

export type PluginUiOrder = Pick<PluginUiStateEnvelope, "epoch" | "seq">;

export function comparePluginUiOrder(
	a: PluginUiOrder,
	b: PluginUiOrder,
): number {
	return a.epoch - b.epoch || a.seq - b.seq;
}

export function applyPluginUiState<S extends PluginUiSlot>(
	current: PluginUiStateEnvelope<S> | undefined,
	next: PluginUiStateEnvelope<S>,
): PluginUiStateEnvelope<S> {
	return !current || comparePluginUiOrder(next, current) > 0 ? next : current;
}

// ── query and invoke ───────────────────────────────────────────────────────

/** Stamped by core or the hub, never taken from the action. */
export interface PluginUiViewer {
	/** Hub: the clientId of the registered connection that sent the call. In-process: "local" unless the caller passes its own id. */
	id: string;
	clientType?: string;
	/** Remembered from this viewer's last `attach`. */
	surface?: PluginUiSurface;
}

export interface PluginUiGetInput {
	sessionId: string;
}

export interface PluginUiInvokeInput<S extends PluginUiSlot = PluginUiSlot> {
	sessionId: string;
	slot: S;
	action: PluginUiAction<S>;
	/** In-process callers only; the hub ignores it and stamps the connection's clientId. */
	viewerId?: string;
}

export type PluginUiInvokeOutcome =
	| "ok"
	| "refused"
	| "rejected"
	| "unavailable"
	| "timeout";

export interface PluginUiInvokeResult<S extends PluginUiSlot = PluginUiSlot> {
	outcome: PluginUiInvokeOutcome;
	/** Present when outcome is "refused". */
	reason?: "stale" | "unsendable";
	/** The slot's current envelope after the action (pending pushes flushed first). Renderers apply it whatever the outcome. */
	state?: PluginUiStateEnvelope<S>;
	/** The session's current epoch, on every reply for a resident session whose chain is not closing, whatever the outcome. */
	epoch?: number;
}

// ── plugin-facing ──────────────────────────────────────────────────────────

export interface PluginUiActionContext {
	sessionId: string;
	viewer: PluginUiViewer;
	/** Viewers attached to this session after this action is applied (attach/detach included). */
	viewers: number;
}

export type PluginUiActionReply =
	| { outcome: "ok" }
	| { outcome: "refused"; reason?: "stale" | "unsendable" }
	| undefined
	// biome-ignore lint/suspicious/noConfusingVoidType: a handler with no return statement infers void
	| void;

export interface AgentExtensionUiSlot<S extends PluginUiSlot = PluginUiSlot> {
	slot: S;
	onAction: (
		action: PluginUiAction<S>,
		context: PluginUiActionContext,
	) => PluginUiActionReply | Promise<PluginUiActionReply>;
}

export interface PluginUiContext {
	/** The session's catalog: slot ids the host that started it renders, as this core knows them. Never empty. */
	readonly slots: readonly string[];
	/** Fire-and-forget. Never throws; invalid or unregistered updates are dropped and logged. */
	update<S extends PluginUiSlot>(slot: S, state: PluginUiState<S> | null): void;
}

// ── normalizers (used by core and renderers) ──────────────────────────────

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

export type PluginUiActionParse =
	| { ok: true; slot: PluginUiSlot; action: PluginUiAction }
	| { ok: false; reason: "unknown_slot" | "too_large" | "invalid" };

const ELLIPSIS = "…";
const TAB = /\t/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping C0/C1 controls (all but "\n") is the purpose of this pattern
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;
const BIDI_AND_ZERO_WIDTH =
	/[\u061C\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;
const WHITESPACE_RUN = /\s+/g;
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
const utf8 = new TextEncoder();

function isOneOf<T extends string>(
	values: readonly T[],
	value: unknown,
): value is T {
	return (
		typeof value === "string" && (values as readonly string[]).includes(value)
	);
}

function exceedsUtf8Bytes(text: string, limit: number): boolean {
	return text.length > limit || utf8.encode(text).byteLength > limit;
}

/**
 * The text pass every state field gets: tabs become spaces; C0/C1 controls
 * other than "\n", bidi and zero-width characters are removed; lone
 * surrogates become U+FFFD; whitespace runs collapse and the ends are trimmed;
 * then the text is clamped by code points with "…". `multiline` (for `prompt`)
 * keeps interior whitespace and newlines and only trims the ends. Idempotent.
 */
export function clampPluginUiText(
	value: string,
	maxChars: number,
	options: { multiline?: boolean } = {},
): string {
	const visible = sanitizeSurrogates(
		value
			.replace(TAB, " ")
			.replace(CONTROL_CHARACTERS, "")
			.replace(BIDI_AND_ZERO_WIDTH, ""),
	);
	const text = options.multiline
		? visible.trim()
		: visible.replace(WHITESPACE_RUN, " ").trim();
	const codePoints = Array.from(text);
	if (codePoints.length <= maxChars) return text;
	return `${codePoints
		.slice(0, Math.max(0, maxChars - 1))
		.join("")
		.trimEnd()}${ELLIPSIS}`;
}

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

function isPluginUiSlot(value: unknown): value is PluginUiSlot {
	return isOneOf(PLUGIN_UI_SLOTS, value);
}

function toPlainJson(
	value: unknown,
	maxBytes: number,
):
	| { ok: true; value: unknown }
	| { ok: false; reason: "unserializable" | "too_large" } {
	let json: string | undefined;
	try {
		json = JSON.stringify(value);
	} catch {
		return { ok: false, reason: "unserializable" };
	}
	if (json === undefined) return { ok: false, reason: "unserializable" };
	if (exceedsUtf8Bytes(json, maxBytes))
		return { ok: false, reason: "too_large" };
	return { ok: true, value: JSON.parse(json) };
}

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

function isEnvelopeShaped(
	value: unknown,
): value is Omit<PluginUiStateEnvelope, "state"> & { state: unknown } {
	if (typeof value !== "object" || value === null) return false;
	const envelope = value as Record<string, unknown>;
	return (
		typeof envelope.sessionId === "string" &&
		envelope.sessionId.length > 0 &&
		isPluginUiSlot(envelope.slot) &&
		typeof envelope.plugin === "string" &&
		typeof envelope.epoch === "number" &&
		Number.isFinite(envelope.epoch) &&
		Number.isSafeInteger(envelope.seq) &&
		(envelope.seq as number) >= 0 &&
		(envelope.state === null || typeof envelope.state === "object")
	);
}

/** Structural check plus lenient re-normalization of `state`. Renderers use this on every inbound envelope. */
export function readPluginUiEnvelope(
	value: unknown,
): PluginUiStateEnvelope | undefined {
	if (!isEnvelopeShaped(value)) return undefined;
	const normalized = normalizePluginUiState(value.slot, value.state);
	if (!normalized.ok) return undefined;
	return {
		sessionId: value.sessionId,
		slot: value.slot,
		plugin: value.plugin,
		epoch: value.epoch,
		seq: value.seq,
		state: normalized.state,
	};
}

/** Deep equality with a plain JSON value: an extra key, a `toJSON` or a non-plain value differs. */
function equalsJson(value: unknown, json: unknown): boolean {
	if (typeof json !== "object" || json === null) return value === json;
	if (typeof value !== "object" || value === null) return false;
	if (Array.isArray(json))
		return (
			Array.isArray(value) &&
			value.length === json.length &&
			json.every((entry, index) => equalsJson(value[index], entry))
		);
	if (Array.isArray(value)) return false;
	const record = value as Record<string, unknown>;
	const keys = Object.keys(json);
	return (
		Object.keys(record).length === keys.length &&
		keys.every(
			(key) =>
				Object.hasOwn(record, key) &&
				equalsJson(record[key], (json as Record<string, unknown>)[key]),
		)
	);
}

/**
 * The envelope's own fields are well formed and its state is already
 * normalized, so narrowing never skips the sanitizers. A state that would
 * still change when normalized fails; read those with `readPluginUiEnvelope`.
 */
export function isPluginUiStateEnvelope(
	value: unknown,
): value is PluginUiStateEnvelope {
	if (!isEnvelopeShaped(value)) return false;
	const normalized = normalizePluginUiState(value.slot, value.state);
	return normalized.ok && equalsJson(value.state, normalized.state);
}

// ── host slot catalog ──────────────────────────────────────────────────────

/** A declared catalog (wire data): the string entries that are in PLUGIN_UI_SLOTS, deduped, in catalog order. Anything else gives []. Never throws. */
export function readPluginUiSlotCatalog(value: unknown): PluginUiSlot[] {
	if (!Array.isArray(value)) return [];
	return PLUGIN_UI_SLOTS.filter((slot) => value.includes(slot));
}
