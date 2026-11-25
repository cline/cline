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
