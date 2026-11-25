import type {
	ComposerSuggestionsState,
	PluginUiInvokeResult,
	PluginUiStateEnvelope,
} from "../contracts";
import { PLUGIN_UI_FIXTURES } from "../fixtures";
import { SUGGESTION_BREAKPOINTS } from "./constants";
import { deriveSuggestionsView } from "./derive";
import { createSuggestionsLocal, reduceSuggestionsLocal } from "./reducer";
import type {
	SuggestionRef,
	SuggestionsHostFacts,
	SuggestionsLocal,
	SuggestionsLocalEvent,
	SuggestionsView,
} from "./types";

export const SESSION = "sess_a";
export const OTHER_SESSION = "sess_b";
export const EPOCH = 1_000;
export const NOW = 50_000;
export const states = PLUGIN_UI_FIXTURES.composerSuggestions;
export const { readyThree } = states;

type Envelope = PluginUiStateEnvelope<"composer.suggestions">;

export function envelope(
	state: ComposerSuggestionsState | null,
	seq: number,
	options: { epoch?: number; sessionId?: string } = {},
): Envelope {
	return {
		sessionId: options.sessionId ?? SESSION,
		slot: "composer.suggestions",
		plugin: "demo",
		epoch: options.epoch ?? EPOCH,
		seq,
		state,
	};
}

export function stateEvent(env: Envelope, now = NOW): SuggestionsLocalEvent {
	return { type: "state", envelope: env, now };
}

export function reply(
	result: PluginUiInvokeResult<"composer.suggestions">,
	sessionId = SESSION,
	now = NOW,
): SuggestionsLocalEvent {
	return { type: "reply", sessionId, result, now };
}

export function reduce(
	local: SuggestionsLocal,
	...events: SuggestionsLocalEvent[]
): SuggestionsLocal {
	return events.reduce(reduceSuggestionsLocal, local);
}

export function bound(...events: SuggestionsLocalEvent[]): SuggestionsLocal {
	return reduce(
		createSuggestionsLocal(),
		{ type: "bind", sessionId: SESSION },
		...events,
	);
}

/** Bound with the three-row set on screen since NOW. */
export function readyOnScreen(
	...events: SuggestionsLocalEvent[]
): SuggestionsLocal {
	return bound(
		stateEvent(envelope(readyThree, 1)),
		{ type: "view", ready: true, now: NOW },
		...events,
	);
}

function host(
	overrides: Partial<SuggestionsHostFacts> = {},
): SuggestionsHostFacts {
	return {
		draft: "",
		busy: false,
		blocked: false,
		queued: 0,
		canUndo: false,
		width: 800,
		breakpoints: SUGGESTION_BREAKPOINTS.desktop,
		now: NOW,
		...overrides,
	};
}

export function view(
	local: SuggestionsLocal,
	overrides: Partial<SuggestionsHostFacts> = {},
): SuggestionsView {
	return deriveSuggestionsView(local, host(overrides));
}

export function readyView(
	local: SuggestionsLocal,
	overrides: Partial<SuggestionsHostFacts> = {},
): Extract<SuggestionsView, { mode: "ready" }> {
	const derived = view(local, overrides);
	if (derived.mode !== "ready")
		throw new Error(`expected ready, got ${derived.mode}`);
	return derived;
}

export const verifyRef: SuggestionRef = {
	itemId: "verify",
	revision: readyThree.revision,
	prompt: "Run the whole test suite",
	label: "Verify",
	tone: "check",
};

export const nextSet: ComposerSuggestionsState = {
	...readyThree,
	revision: "r9",
	items: readyThree.items.slice(1),
};
