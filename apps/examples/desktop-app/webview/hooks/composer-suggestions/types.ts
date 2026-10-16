import type {
	ComposerSuggestionItem,
	ComposerSuggestionsAction,
	PluginUiInput,
	PluginUiInvokeResult,
	PluginUiStateEnvelope,
	SuggestionsLocal,
	SuggestionsLocalEvent,
	SuggestionsView,
} from "@cline/shared/browser";
import type { Dispatch } from "react";
import type { PromptInQueue } from "@/hooks/chat-session/types";
import type { ChatMessage, ChatSessionStatus } from "@/lib/chat-schema";

export type SuggestionsEnvelope = PluginUiStateEnvelope<"composer.suggestions">;
export type SuggestionsResult = PluginUiInvokeResult<"composer.suggestions">;
export type ReadyView = Extract<SuggestionsView, { mode: "ready" }>;

/** The message box the tray fills and empties; owned by the composer. */
export type SuggestionComposer = {
	draft(): string;
	setDraft(value: string): void;
	focus(): void;
};

/** What the tray's view depends on that only the composer knows. */
export type SuggestionComposerFacts = {
	draft: string;
	width: number;
	/** The slash or @ menu is open over the message box. */
	menuOpen: boolean;
	/** A dialog is open over the page. */
	dialogOpen: boolean;
};

export type ComposerSuggestionsOptions = {
	/** Local execution only: an SSH or cloud pane never gets or attaches. */
	enabled: boolean;
	environmentId: string;
	sessionId: string | null;
	status: ChatSessionStatus;
	/** The displayed chat is still loading; its placeholder `starting` status is not a run. */
	loadingChat: boolean;
	/** A tool approval or a question is waiting on the person. */
	waiting: boolean;
	messages: ChatMessage[];
	promptsInQueue: readonly PromptInQueue[];
	onSend: (prompt: string) => void;
	/** Forks the session from before `runCount` with `content` as the new draft. */
	onUndoTurn: (
		messageId: string,
		content: string,
		runCount: number,
	) => Promise<void>;
	/** Resolves the prompt it took out of the queue, or undefined when it was no longer queued. */
	onRemoveQueuedPrompt: (
		promptId: string,
	) => Promise<PromptInQueue | undefined>;
	abort: () => Promise<void> | void;
};

export type ComposerSuggestionsController = {
	enabled: boolean;
	/** A run is in progress; Esc belongs to its abort then. */
	busy: boolean;
	local: SuggestionsLocal;
	/** The clock renders derive with; key and button handlers pass `Date.now()`. */
	now: number;
	/** The item whose one-key Send is waiting for its verdict. */
	sendingItemId?: string;
	/** A skipped row can be brought back from the More menu. */
	canUnskip: boolean;
	view(facts: SuggestionComposerFacts, now?: number): SuggestionsView;
	/**
	 * Render feedback: starts the exposure clock while a ready view is on
	 * screen, stops it otherwise, and reports exposure once it has run.
	 */
	reportView(view: SuggestionsView, onScreen: boolean): void;
	move(delta: 1 | -1): void;
	highlight(itemId: string): void;
	use(
		item: ComposerSuggestionItem,
		input: PluginUiInput,
		composer: SuggestionComposer,
	): void;
	/** One-key Send of the highlighted row, or `signal key_inert` when it may not be sent yet. */
	send(view: ReadyView, input: PluginUiInput): Promise<void>;
	skip(
		view: ReadyView,
		item: ComposerSuggestionItem,
		input: PluginUiInput,
	): void;
	refresh(input: PluginUiInput): void;
	unskip(input: PluginUiInput): void;
	/** Hide for this turn: collapse here, and tell the plugin it was ignored. */
	collapse(input: PluginUiInput): void;
	hideForChat(input: PluginUiInput): void;
	show(input: PluginUiInput): void;
	clear(input: PluginUiInput, composer: SuggestionComposer): void;
	undoSent(composer: SuggestionComposer): Promise<void>;
	/** The composer is submitting `prompt` through its own send path. */
	submitted(prompt: string): void;
	/** The box emptied while it held a used suggestion; tells the plugin, as Esc's Clear does. */
	draftCleared(): void;
};

export type SuggestionsDispatch = Dispatch<SuggestionsLocalEvent>;

export type SuggestionsInvoke = (
	action: ComposerSuggestionsAction,
	options?: { applyReply?: boolean },
) => Promise<SuggestionsResult | undefined>;

export type LastSkip = { revision: string; itemId: string };
