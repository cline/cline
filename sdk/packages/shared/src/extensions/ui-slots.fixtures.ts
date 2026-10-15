import type {
	ComposerSuggestionItem,
	ComposerSuggestionsState,
	PluginUiStateNormalization,
} from "./ui-slots";

/** An input a plugin (or a newer core) might push, and what `normalizePluginUiState` makes of it. */
export interface PluginUiHostileFixture {
	readonly name: string;
	readonly slot: string;
	readonly value: unknown;
	readonly expected: PluginUiStateNormalization;
}

const verify: ComposerSuggestionItem = {
	id: "verify",
	label: "Verify",
	tone: "check",
	icon: "verify",
	prompt: "Run the whole test suite",
	detail: "Nothing ran this turn",
	sendable: true,
};

const commit: ComposerSuggestionItem = {
	id: "commit",
	label: "Commit",
	tone: "finish",
	icon: "commit",
	prompt: "Commit these changes",
	sendable: true,
};

const replyToReview: ComposerSuggestionItem = {
	id: "reply-review",
	label: "Reply",
	tone: "decide",
	icon: "reply",
	prompt: "Reply to the review comments on the pull request",
	detail: "Two comments are waiting",
	source: { label: "GitHub", url: "https://github.com/cline/cline/pull/1" },
	sendable: false,
};

const readyOne: ComposerSuggestionsState = {
	status: "ready",
	title: "Next",
	command: "next",
	cue: { text: "after a command failed", tone: "repair" },
	revision: "r1",
	items: [verify],
	canRefresh: false,
};

const readyThree: ComposerSuggestionsState = {
	status: "ready",
	title: "Next",
	command: "next",
	cue: { text: "after 2 files changed", tone: "neutral" },
	revision: "r2",
	items: [verify, commit, replyToReview],
	canRefresh: true,
};

const hidden: ComposerSuggestionsState = {
	status: "hidden",
	title: "Next",
	command: "next",
	revision: "none",
	items: [],
	canRefresh: false,
};

/** Golden states for each status; every one is already normalized. */
const composerSuggestions = {
	readyOne,
	readyThree,
	loading: {
		status: "loading",
		title: "Next",
		command: "next",
		cue: { text: "reading the last turn…", tone: "neutral" },
		revision: "r2",
		items: [],
		canRefresh: false,
	},
	empty: {
		status: "empty",
		title: "Next",
		command: "next",
		cue: { text: "after the last reply", tone: "neutral" },
		revision: "r3",
		items: [],
		canRefresh: false,
	},
	exhausted: {
		status: "exhausted",
		title: "Next",
		command: "next",
		revision: "r4",
		items: [],
		canRefresh: false,
	},
	unavailable: {
		status: "unavailable",
		title: "Next",
		command: "next",
		note: "Suggestions are unavailable right now",
		revision: "r5",
		items: [],
		canRefresh: false,
	},
	hidden,
	hiddenSuperseded: { ...hidden, hiddenReason: "superseded" },
	hiddenUser: { ...hidden, hiddenReason: "user" },
	hiddenDisabled: { ...hidden, hiddenReason: "disabled" },
} satisfies Record<string, ComposerSuggestionsState>;

const cyclic: Record<string, unknown> = { ...readyOne };
cyclic.self = cyclic;

function keptAs(state: ComposerSuggestionsState): PluginUiStateNormalization {
	return { ok: true, slot: "composer.suggestions", state };
}

function withItem(
	state: ComposerSuggestionsState,
	item: ComposerSuggestionItem,
): ComposerSuggestionsState {
	return { ...state, items: [item] };
}

const hostile: readonly PluginUiHostileFixture[] = [
	{
		name: "a BigInt",
		slot: "composer.suggestions",
		value: { ...readyOne, canRefresh: 1n },
		expected: { ok: false, reason: "unserializable" },
	},
	{
		name: "a cycle",
		slot: "composer.suggestions",
		value: cyclic,
		expected: { ok: false, reason: "unserializable" },
	},
	{
		name: "a Map where items belong",
		slot: "composer.suggestions",
		value: { ...readyOne, items: new Map([["verify", verify]]) },
		expected: { ok: false, reason: "invalid" },
	},
	{
		name: "a 1 MB prompt",
		slot: "composer.suggestions",
		value: withItem(readyOne, { ...verify, prompt: "x".repeat(1024 * 1024) }),
		expected: { ok: false, reason: "too_large" },
	},
	{
		name: "terminal escape sequences",
		slot: "composer.suggestions",
		value: withItem(readyOne, {
			...verify,
			detail: "\u001b]0;owned\u0007\u001b[2JNothing ran",
		}),
		expected: keptAs(
			withItem(readyOne, { ...verify, detail: "]0;owned[2JNothing ran" }),
		),
	},
	{
		name: "bidi controls",
		slot: "composer.suggestions",
		value: withItem(readyOne, {
			...verify,
			prompt: "Run the \u202Etests\u202C \u2066now\u2069",
		}),
		expected: keptAs(
			withItem(readyOne, { ...verify, prompt: "Run the tests now" }),
		),
	},
	{
		name: "a javascript: url",
		slot: "composer.suggestions",
		value: withItem(readyOne, {
			...verify,
			source: { label: "Docs", url: "javascript:alert(1)" },
		}),
		expected: keptAs(
			withItem(readyOne, { ...verify, source: { label: "Docs" } }),
		),
	},
	{
		name: "a file: url",
		slot: "composer.suggestions",
		value: withItem(readyOne, {
			...verify,
			source: { label: "Docs", url: "file:///etc/passwd" },
		}),
		expected: keptAs(
			withItem(readyOne, { ...verify, source: { label: "Docs" } }),
		),
	},
	{
		name: "a credentialed url",
		slot: "composer.suggestions",
		value: withItem(readyOne, {
			...verify,
			source: { label: "Docs", url: "https://user:secret@example.com/" },
		}),
		expected: keptAs(
			withItem(readyOne, { ...verify, source: { label: "Docs" } }),
		),
	},
	{
		name: "a slash-command prompt",
		slot: "composer.suggestions",
		value: { ...readyOne, items: [verify, { ...commit, prompt: "/clear" }] },
		expected: keptAs(readyOne),
	},
	{
		name: "an unknown tone",
		slot: "composer.suggestions",
		value: withItem(readyOne, {
			...verify,
			tone: "sparkle",
		} as unknown as ComposerSuggestionItem),
		expected: keptAs(withItem(readyOne, { ...verify, tone: "neutral" })),
	},
	{
		name: "an unknown icon",
		slot: "composer.suggestions",
		value: withItem(readyOne, {
			...verify,
			icon: "skull",
		} as unknown as ComposerSuggestionItem),
		expected: keptAs(
			withItem(readyOne, {
				id: verify.id,
				label: verify.label,
				tone: verify.tone,
				prompt: verify.prompt,
				detail: verify.detail,
				sendable: verify.sendable,
			}),
		),
	},
	{
		name: "an unknown status",
		slot: "composer.suggestions",
		value: { ...readyOne, status: "dancing" },
		expected: keptAs({ ...readyOne, status: "hidden" }),
	},
	{
		name: "an unknown slot",
		slot: "composer.everything",
		value: readyOne,
		expected: { ok: false, reason: "unknown_slot" },
	},
	{
		name: "extra keys",
		slot: "composer.suggestions",
		value: {
			...readyOne,
			html: "<b>bold</b>",
			items: [{ ...verify, onClick: "steal()" }],
		},
		expected: keptAs(readyOne),
	},
];

/**
 * Golden states for each status, plus hostile inputs with what the normalizer
 * makes of them. Shared by core, plugin and every renderer's tests; published
 * only through `@cline/shared/testing`.
 */
export const PLUGIN_UI_FIXTURES = {
	composerSuggestions,
	hostile,
};
