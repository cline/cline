"use client";

import {
	type ComposerSuggestionItem,
	type ComposerSuggestionsAction,
	createSuggestionsLocal,
	deriveSuggestionsView,
	formatDisplayUserInput,
	type PluginUiInput,
	type PluginUiInvokeOutcome,
	type PluginUiInvokeResult,
	type PluginUiStateEnvelope,
	readPluginUiEnvelope,
	reduceSuggestionsLocal,
	SUGGESTION_BREAKPOINTS,
	SUGGESTION_EXPOSURE_MS,
	SUGGESTION_PENDING_UNDO_MS,
	SUGGESTION_SEND_VERDICT_MS,
	type SuggestionRef,
	type SuggestionsLocal,
	type SuggestionsView,
} from "@cline/shared/browser";
import {
	useCallback,
	useEffect,
	useMemo,
	useReducer,
	useRef,
	useState,
} from "react";
import { buildUserRunCountMap } from "@/components/views/chat/messages/group-messages";
import type { PromptInQueue } from "@/hooks/chat-session/types";
import { BUSY_STATUSES } from "@/hooks/use-chat-session";
import { toast } from "@/hooks/use-toast";
import type { ChatMessage, ChatSessionStatus } from "@/lib/chat-schema";
import { desktopClient } from "@/lib/desktop-client";
import { eventEnvironmentId } from "@/lib/session-identity";

const SLOT = "composer.suggestions";
/** ⌘3 waits this long for a stopped run to go idle before it forks. */
const STOP_WAIT_MS = 5_000;
const STOP_POLL_MS = 50;
const STILL_STOPPING = "Still stopping — try again";
/** The queue would not give the prompt back: it already started, or the sidecar does not know its id yet. */
const NOT_TAKEN_BACK = "Couldn't take it back yet — try again";
/** Sessions, and revisions per session, the webview remembers as exposed; the view model keeps 32 revisions too. */
const EXPOSED_SESSIONS_KEPT = 32;
const EXPOSED_REVISIONS_KEPT = 32;

type SuggestionsEnvelope = PluginUiStateEnvelope<"composer.suggestions">;
type SuggestionsResult = PluginUiInvokeResult<"composer.suggestions">;
type ReadyView = Extract<SuggestionsView, { mode: "ready" }>;

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

const INVOKE_OUTCOMES: ReadonlySet<string> = new Set<PluginUiInvokeOutcome>([
	"ok",
	"refused",
	"rejected",
	"unavailable",
	"timeout",
]);

function readSuggestionsEnvelope(
	value: unknown,
): SuggestionsEnvelope | undefined {
	const envelope = readPluginUiEnvelope(value);
	return envelope?.slot === SLOT ? envelope : undefined;
}

function readInvokeResult(value: unknown): SuggestionsResult {
	const record =
		value && typeof value === "object"
			? (value as Record<string, unknown>)
			: {};
	const { outcome, reason, epoch } = record;
	if (typeof outcome !== "string" || !INVOKE_OUTCOMES.has(outcome)) {
		return { outcome: "unavailable" };
	}
	const state = readSuggestionsEnvelope(record.state);
	return {
		outcome: outcome as PluginUiInvokeOutcome,
		...(reason === "stale" || reason === "unsendable" ? { reason } : {}),
		...(state ? { state } : {}),
		...(typeof epoch === "number" && Number.isFinite(epoch) ? { epoch } : {}),
	};
}

function msSinceExposed(local: SuggestionsLocal): { msSinceExposed?: number } {
	return local.readyAt === undefined
		? {}
		: { msSinceExposed: Math.max(0, Math.round(Date.now() - local.readyAt)) };
}

/**
 * Revisions each session's tray already reported exposed, outliving the pane:
 * ChatThreadPane is keyed per thread, so leaving a session and coming back
 * remounts the hook, and the view model's own set would start empty.
 */
function createExposedSuggestionMemory() {
	const bySession = new Map<string, readonly string[]>();
	const keyOf = (environmentId: string, sessionId: string) =>
		`${environmentId}\n${sessionId}`;
	return {
		revisions(environmentId: string, sessionId: string): readonly string[] {
			return bySession.get(keyOf(environmentId, sessionId)) ?? [];
		},
		remember(environmentId: string, sessionId: string, revision: string) {
			const key = keyOf(environmentId, sessionId);
			const kept = (bySession.get(key) ?? []).filter(
				(remembered) => remembered !== revision,
			);
			bySession.delete(key);
			bySession.set(key, [...kept, revision].slice(-EXPOSED_REVISIONS_KEPT));
			for (const oldest of bySession.keys()) {
				if (bySession.size <= EXPOSED_SESSIONS_KEPT) break;
				bySession.delete(oldest);
			}
		},
		clear() {
			bySession.clear();
		},
	};
}

export const exposedSuggestionMemory = createExposedSuggestionMemory();

/** A prompt taken back from the queue goes in front of anything typed since, never over it. */
function takenBackDraft(prompt: string, draft: string): string {
	return draft.trim() && !samePrompt(draft, prompt)
		? `${prompt}\n\n${draft}`
		: prompt;
}

function delay(ms: number): Promise<undefined> {
	return new Promise((resolve) => setTimeout(() => resolve(undefined), ms));
}

function samePrompt(text: string, prompt: string): boolean {
	return formatDisplayUserInput(text.trim()).trim() === prompt.trim();
}

/** The last user message showing `prompt`, with the run count a fork from before it needs. */
export function findSentMessage(
	messages: ChatMessage[],
	prompt: string,
): { messageId: string; runCount: number } | undefined {
	const runCounts = buildUserRunCountMap(messages);
	const message = messages.findLast(
		(candidate) =>
			candidate.role === "user" && samePrompt(candidate.content, prompt),
	);
	const runCount = message ? runCounts.get(message) : undefined;
	return message && runCount !== undefined
		? { messageId: message.id, runCount }
		: undefined;
}

/**
 * The composer.suggestions slot for one chat pane: binds to the displayed
 * session (`get`, then `attach`) on open, switch and transport reconnect,
 * applies its states through the shared reducer, keeps the view model's
 * clock, and sends every verb through the sidecar's `plugin_ui_invoke`.
 */
export function useComposerSuggestions(
	options: ComposerSuggestionsOptions,
): ComposerSuggestionsController {
	const { enabled, environmentId, sessionId, status, loadingChat, waiting } =
		options;
	const busy = BUSY_STATUSES.has(status) && !loadingChat;
	const [local, dispatch] = useReducer(
		reduceSuggestionsLocal,
		undefined,
		createSuggestionsLocal,
	);
	const [now, setNow] = useState(() => Date.now());
	const [sendingItemId, setSendingItemId] = useState<string>();
	const [lastSkip, setLastSkip] = useState<{
		revision: string;
		itemId: string;
	}>();
	const [connectedEpoch, setConnectedEpoch] = useState(0);

	const localRef = useRef(local);
	localRef.current = local;
	const statusRef = useRef(status);
	statusRef.current = status;
	const busyRef = useRef(busy);
	busyRef.current = busy;
	const onUndoTurnRef = useRef(options.onUndoTurn);
	onUndoTurnRef.current = options.onUndoTurn;
	const latest = useRef(options);
	latest.current = options;
	/**
	 * The session verbs go to; empty while unbound or disabled. An unmount
	 * leaves it set, so a Send the person already made still reaches the chat they left.
	 */
	const boundRef = useRef("");
	/** Bumped on every bind and unbind, so a reply to an earlier bind is never applied. */
	const generationRef = useRef(0);
	/** The due re-attach already sent (its epoch, or null without one); undefined while none is due. */
	const attachingForRef = useRef<number | null | undefined>(undefined);
	/** A one-key Send is waiting for its verdict; another press then sends nothing. */
	const sendInFlightRef = useRef(false);
	/** An Undo is taking the sent prompt back; another press then does nothing. */
	const undoInFlightRef = useRef(false);

	useEffect(
		() =>
			desktopClient.subscribeTransportState((state) => {
				if (state !== "connected") return;
				setConnectedEpoch((epoch) => epoch + 1);
			}),
		[],
	);

	const invokeFor = useCallback(
		async (
			targetSessionId: string,
			action: ComposerSuggestionsAction,
		): Promise<SuggestionsResult> => {
			try {
				return readInvokeResult(
					await desktopClient.invoke("plugin_ui_invoke", {
						environmentId,
						sessionId: targetSessionId,
						slot: SLOT,
						action,
					}),
				);
			} catch {
				return { outcome: "unavailable" };
			}
		},
		[environmentId],
	);

	/**
	 * Invokes on the bound session, or resolves undefined while unbound. The
	 * reply reaches the reducer only while that bind lasts; the caller always
	 * gets the plugin's verdict, so a refusal still stops a Send whose pane left.
	 */
	const invoke = useCallback(
		async (
			action: ComposerSuggestionsAction,
			{ applyReply = true }: { applyReply?: boolean } = {},
		): Promise<SuggestionsResult | undefined> => {
			const targetSessionId = boundRef.current;
			const generation = generationRef.current;
			if (!targetSessionId) return undefined;
			const result = await invokeFor(targetSessionId, action);
			if (applyReply && generation === generationRef.current) {
				dispatch({
					type: "reply",
					sessionId: targetSessionId,
					result,
					now: Date.now(),
				});
			}
			return result;
		},
		[invokeFor],
	);

	const attach = useCallback(
		async (targetSessionId: string, generation: number) => {
			const result = await invokeFor(targetSessionId, {
				verb: "attach",
				surface: "desktop",
			});
			if (generation !== generationRef.current) return;
			dispatch({
				type: "reply",
				sessionId: targetSessionId,
				result,
				now: Date.now(),
			});
			dispatch({
				type: "attached",
				sessionId: targetSessionId,
				outcome: result.outcome,
				epoch: result.epoch,
			});
		},
		[invokeFor],
	);

	const live = enabled && Boolean(sessionId) && connectedEpoch > 0;
	// biome-ignore lint/correctness/useExhaustiveDependencies: connectedEpoch rebinds on every transport reconnect
	useEffect(() => {
		generationRef.current += 1;
		const generation = generationRef.current;
		const boundSessionId = live && sessionId ? sessionId : "";
		boundRef.current = boundSessionId;
		attachingForRef.current = undefined;
		setLastSkip(undefined);
		dispatch({ type: "bind", sessionId: sessionId ?? "" });
		if (sessionId) {
			for (const revision of exposedSuggestionMemory.revisions(
				environmentId,
				sessionId,
			)) {
				dispatch({ type: "exposed", revision });
			}
		}
		if (!boundSessionId) return;
		void (async () => {
			let states: unknown;
			try {
				states = await desktopClient.invoke("plugin_ui_get", {
					environmentId,
					sessionId: boundSessionId,
				});
			} catch {
				states = [];
			}
			if (generation !== generationRef.current) return;
			for (const value of Array.isArray(states) ? states : []) {
				const envelope = readSuggestionsEnvelope(value);
				if (envelope) dispatch({ type: "state", envelope, now: Date.now() });
			}
			if (busyRef.current) dispatch({ type: "run_started" });
			await attach(boundSessionId, generation);
		})();
		return () => {
			generationRef.current += 1;
			void invokeFor(boundSessionId, { verb: "detach" });
		};
	}, [attach, connectedEpoch, environmentId, invokeFor, live, sessionId]);

	useEffect(() => {
		if (!enabled) return;
		return desktopClient.subscribe("plugin_ui_state", (payload) => {
			if (eventEnvironmentId(payload) !== environmentId) return;
			const record = payload as { sessionId?: unknown; envelope?: unknown };
			const boundSessionId = boundRef.current;
			if (!boundSessionId || record.sessionId !== boundSessionId) return;
			const envelope = readSuggestionsEnvelope(record.envelope);
			if (envelope) dispatch({ type: "state", envelope, now: Date.now() });
		});
	}, [enabled, environmentId]);

	useEffect(() => {
		if (!local.attachDue) {
			attachingForRef.current = undefined;
			return;
		}
		const due = local.attachDueFor ?? null;
		const boundSessionId = boundRef.current;
		if (!boundSessionId || attachingForRef.current === due) return;
		attachingForRef.current = due;
		void attach(boundSessionId, generationRef.current);
	}, [attach, local.attachDue, local.attachDueFor]);

	const wasBusyRef = useRef(busy);
	useEffect(() => {
		if (busy && !wasBusyRef.current) dispatch({ type: "run_started" });
		if (!busy && wasBusyRef.current) dispatch({ type: "run_ended" });
		wasBusyRef.current = busy;
	}, [busy]);

	useEffect(() => {
		const at = Date.now();
		const deadlines = [
			local.readyAt === undefined
				? undefined
				: local.readyAt + SUGGESTION_EXPOSURE_MS,
			local.staleUntil,
			local.pendingSince === undefined
				? undefined
				: local.pendingSince + SUGGESTION_PENDING_UNDO_MS,
		].filter((deadline): deadline is number => deadline !== undefined);
		const next = Math.min(...deadlines.filter((deadline) => deadline > now));
		if (!Number.isFinite(next)) return;
		const timer = setTimeout(
			() => {
				const fired = Date.now();
				setNow(fired);
				dispatch({ type: "tick", now: fired });
			},
			Math.max(0, next - at),
		);
		return () => clearTimeout(timer);
	}, [local.pendingSince, local.readyAt, local.staleUntil, now]);

	const sentPrompt = local.sent?.prompt;
	const queuedSent = useMemo(
		() =>
			sentPrompt === undefined
				? undefined
				: options.promptsInQueue.find((item) =>
						samePrompt(item.prompt, sentPrompt),
					),
		[options.promptsInQueue, sentPrompt],
	);
	const sentMessage = useMemo(
		() =>
			sentPrompt === undefined
				? undefined
				: findSentMessage(options.messages, sentPrompt),
		[options.messages, sentPrompt],
	);
	const canUndo = Boolean(queuedSent || sentMessage);
	const queued = options.promptsInQueue.length;

	const reportView = useCallback(
		(view: SuggestionsView, onScreen: boolean) => {
			const at = Date.now();
			const ready = view.mode === "ready" && onScreen;
			dispatch({ type: "view", ready, now: at });
			if (!ready || view.mode !== "ready") return;
			const current = localRef.current;
			const revision = current.envelope?.state?.revision;
			const boundSessionId = boundRef.current;
			if (
				!revision ||
				!boundSessionId ||
				current.readyAt === undefined ||
				current.exposedRevisions.has(revision) ||
				at - current.readyAt < SUGGESTION_EXPOSURE_MS
			) {
				return;
			}
			const shown =
				view.density === "compact"
					? [view.highlighted]
					: view.rows.map((row) => row.item);
			dispatch({ type: "exposed", revision });
			exposedSuggestionMemory.remember(
				latest.current.environmentId,
				boundSessionId,
				revision,
			);
			void invoke(
				{ verb: "exposed", revision, itemIds: shown.map((item) => item.id) },
				{ applyReply: false },
			);
		},
		[invoke],
	);

	const signalInert = useCallback(
		(reason: "not_exposed" | "unsendable" | "stale") => {
			const revision = localRef.current.envelope?.state?.revision;
			void invoke(
				{
					verb: "signal",
					name: "key_inert",
					reason,
					...(revision ? { revision } : {}),
				},
				{ applyReply: false },
			);
		},
		[invoke],
	);

	const use = useCallback(
		(
			item: ComposerSuggestionItem,
			input: PluginUiInput,
			composer: SuggestionComposer,
		) => {
			const current = localRef.current;
			const revision = current.envelope?.state?.revision;
			if (!revision) return;
			composer.setDraft(item.prompt);
			composer.focus();
			dispatch({ type: "used", itemId: item.id });
			const boundSessionId = boundRef.current;
			void invoke({
				verb: "use",
				revision,
				itemId: item.id,
				input,
				...msSinceExposed(current),
			}).then((result) => {
				if (result?.outcome !== "refused") return;
				if (boundRef.current !== boundSessionId) return;
				const used = localRef.current.used;
				if (used?.itemId === item.id && used.revision === revision) {
					dispatch({ type: "draft_cleared" });
				}
				if (composer.draft() === item.prompt) composer.setDraft("");
			});
		},
		[invoke],
	);

	const send = useCallback(
		async (view: ReadyView, input: PluginUiInput) => {
			if (sendInFlightRef.current) return;
			const item = view.highlighted;
			if (!view.canSend) {
				signalInert(item.sendable ? "not_exposed" : "unsendable");
				return;
			}
			const current = localRef.current;
			const revision = current.envelope?.state?.revision;
			const boundSessionId = boundRef.current;
			if (!revision || !boundSessionId) return;
			const ref: SuggestionRef = {
				itemId: item.id,
				revision,
				prompt: item.prompt,
				label: item.label,
				tone: item.tone,
			};
			sendInFlightRef.current = true;
			setSendingItemId(item.id);
			try {
				const verdict = await Promise.race([
					invoke({
						verb: "send",
						revision,
						itemId: item.id,
						input,
						...msSinceExposed(current),
					}),
					delay(SUGGESTION_SEND_VERDICT_MS),
				]);
				if (verdict?.outcome === "refused") return;
				if (boundRef.current !== boundSessionId) return;
				latest.current.onSend(ref.prompt);
				dispatch({ type: "sent", ref });
			} finally {
				sendInFlightRef.current = false;
				setSendingItemId(undefined);
			}
		},
		[invoke, signalInert],
	);

	const skip = useCallback(
		(view: ReadyView, item: ComposerSuggestionItem, input: PluginUiInput) => {
			const current = localRef.current;
			const revision = current.envelope?.state?.revision;
			if (!revision) return;
			const at = Date.now();
			if (view.skipMeans === "more") {
				dispatch({ type: "refresh_pending", now: at });
				void invoke({ verb: "refresh", revision, input, cause: "more" });
				return;
			}
			dispatch({ type: "skip_pending", itemId: item.id, now: at });
			setLastSkip({ revision, itemId: item.id });
			void invoke({
				verb: "skip",
				revision,
				itemId: item.id,
				input,
				...msSinceExposed(current),
			});
		},
		[invoke],
	);

	const refresh = useCallback(
		(input: PluginUiInput) => {
			const revision = localRef.current.envelope?.state?.revision;
			if (!revision) return;
			dispatch({ type: "refresh_pending", now: Date.now() });
			void invoke({ verb: "refresh", revision, input, cause: "new_set" });
		},
		[invoke],
	);

	const unskip = useCallback(
		(input: PluginUiInput) => {
			if (!lastSkip) return;
			setLastSkip(undefined);
			void invoke({ verb: "unskip", ...lastSkip, input });
		},
		[invoke, lastSkip],
	);

	const collapse = useCallback(
		(input: PluginUiInput) => {
			const revision = localRef.current.envelope?.state?.revision;
			dispatch({ type: "collapse" });
			void invoke(
				{
					verb: "hide",
					scope: "turn",
					input,
					...(revision ? { revision } : {}),
				},
				{ applyReply: false },
			);
		},
		[invoke],
	);

	const hideForChat = useCallback(
		(input: PluginUiInput) => {
			const revision = localRef.current.envelope?.state?.revision;
			void invoke({
				verb: "hide",
				scope: "chat",
				input,
				...(revision ? { revision } : {}),
			});
		},
		[invoke],
	);

	const show = useCallback(
		(input: PluginUiInput) => {
			void invoke({ verb: "show", input });
		},
		[invoke],
	);

	const draftCleared = useCallback(() => {
		const used = localRef.current.used;
		if (!used) return;
		dispatch({ type: "draft_cleared" });
		void invoke(
			{ verb: "clear", revision: used.revision, itemId: used.itemId },
			{ applyReply: false },
		);
	}, [invoke]);

	const clear = useCallback(
		(_input: PluginUiInput, composer: SuggestionComposer) => {
			if (!localRef.current.used) return;
			composer.setDraft("");
			draftCleared();
		},
		[draftCleared],
	);

	/**
	 * A sent prompt the queue still holds comes back into the box with no verb,
	 * since no turn ran. Otherwise, including when the runtime started it before
	 * the removal landed, the turn is forked away from before the sent message,
	 * after stopping a run the fork would refuse.
	 */
	const undoSent = useCallback(
		async (composer: SuggestionComposer) => {
			const sent = localRef.current.sent;
			if (!sent || undoInFlightRef.current) return;
			undoInFlightRef.current = true;
			const { abort, onRemoveQueuedPrompt, promptsInQueue } = latest.current;
			try {
				const queuedPrompt = promptsInQueue.find((item) =>
					samePrompt(item.prompt, sent.prompt),
				);
				/** A prompt still queued has no message of its own, so a match now is an earlier copy. */
				let earlierCopyId: string | undefined;
				if (queuedPrompt) {
					earlierCopyId = findSentMessage(
						latest.current.messages,
						sent.prompt,
					)?.messageId;
					if (await onRemoveQueuedPrompt(queuedPrompt.id)) {
						composer.setDraft(takenBackDraft(sent.prompt, composer.draft()));
						composer.focus();
						dispatch({ type: "unsent" });
						return;
					}
					if (localRef.current.sent !== sent) return;
				}
				const target = findSentMessage(latest.current.messages, sent.prompt);
				if (!target || target.messageId === earlierCopyId) {
					if (queuedPrompt) toast({ title: NOT_TAKEN_BACK });
					return;
				}
				if (BUSY_STATUSES.has(statusRef.current)) {
					void abort();
					const deadline = Date.now() + STOP_WAIT_MS;
					while (
						BUSY_STATUSES.has(statusRef.current) &&
						Date.now() < deadline
					) {
						await delay(STOP_POLL_MS);
					}
					if (BUSY_STATUSES.has(statusRef.current)) {
						toast({ title: STILL_STOPPING });
						return;
					}
				}
				await Promise.race([
					invoke({
						verb: "undo",
						revision: sent.revision,
						itemId: sent.itemId,
					}),
					delay(SUGGESTION_SEND_VERDICT_MS),
				]);
				await onUndoTurnRef.current(
					target.messageId,
					sent.prompt,
					target.runCount,
				);
			} catch (error) {
				toast({
					variant: "destructive",
					title: "Could not undo the suggestion",
					description: error instanceof Error ? error.message : String(error),
				});
			} finally {
				undoInFlightRef.current = false;
			}
		},
		[invoke],
	);

	const submitted = useCallback(
		(prompt: string) => {
			const used = localRef.current.used;
			if (!used) return;
			if (prompt.trim() !== used.prompt.trim()) {
				dispatch({ type: "draft_cleared" });
				return;
			}
			void invoke({
				verb: "send",
				revision: used.revision,
				itemId: used.itemId,
				input: "key",
			});
			dispatch({ type: "sent" });
		},
		[invoke],
	);

	const move = useCallback((delta: 1 | -1) => {
		dispatch({ type: "move", delta });
	}, []);

	const highlight = useCallback((itemId: string) => {
		dispatch({ type: "highlight", itemId });
	}, []);

	return useMemo<ComposerSuggestionsController>(
		() => ({
			enabled,
			busy,
			local,
			now,
			sendingItemId,
			canUnskip: lastSkip !== undefined,
			view: (facts, at = now) =>
				deriveSuggestionsView(local, {
					draft: facts.draft.trim() ? facts.draft : "",
					busy,
					blocked: waiting || facts.menuOpen || facts.dialogOpen,
					queued,
					canUndo,
					width: facts.width,
					breakpoints: SUGGESTION_BREAKPOINTS.desktop,
					now: at,
				}),
			reportView,
			move,
			highlight,
			use,
			send,
			skip,
			refresh,
			unskip,
			collapse,
			hideForChat,
			show,
			clear,
			undoSent,
			submitted,
			draftCleared,
		}),
		[
			busy,
			canUndo,
			clear,
			collapse,
			draftCleared,
			enabled,
			hideForChat,
			highlight,
			lastSkip,
			local,
			move,
			now,
			queued,
			refresh,
			reportView,
			send,
			sendingItemId,
			show,
			skip,
			submitted,
			undoSent,
			unskip,
			use,
			waiting,
		],
	);
}
