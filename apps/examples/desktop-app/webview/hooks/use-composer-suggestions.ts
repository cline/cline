"use client";

import {
	createSuggestionsLocal,
	deriveSuggestionsView,
	reduceSuggestionsLocal,
	SUGGESTION_BREAKPOINTS,
	SUGGESTION_EXPOSURE_MS,
	SUGGESTION_PENDING_UNDO_MS,
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
import { exposedSuggestionMemory } from "@/hooks/composer-suggestions/exposed-memory";
import {
	findSentMessage,
	samePrompt,
} from "@/hooks/composer-suggestions/sent-prompt";
import type {
	ComposerSuggestionsController,
	ComposerSuggestionsOptions,
	LastSkip,
} from "@/hooks/composer-suggestions/types";
import { useSlotBinding } from "@/hooks/composer-suggestions/use-slot-binding";
import { useUndoSent } from "@/hooks/composer-suggestions/use-undo-sent";
import { useSuggestionVerbs } from "@/hooks/composer-suggestions/use-verbs";
import { BUSY_STATUSES } from "@/hooks/use-chat-session";

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
	const [lastSkip, setLastSkip] = useState<LastSkip>();

	const localRef = useRef(local);
	localRef.current = local;
	const latest = useRef(options);
	latest.current = options;

	const { invoke, boundRef } = useSlotBinding({
		enabled,
		environmentId,
		sessionId,
		busy,
		attachDue: local.attachDue,
		attachDueFor: local.attachDueFor,
		dispatch,
		setLastSkip,
	});

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
		[boundRef, invoke],
	);

	const {
		use,
		send,
		skip,
		refresh,
		unskip,
		collapse,
		hideForChat,
		show,
		clear,
		submitted,
		draftCleared,
		move,
		highlight,
	} = useSuggestionVerbs({
		invoke,
		boundRef,
		localRef,
		latest,
		dispatch,
		lastSkip,
		setLastSkip,
		setSendingItemId,
	});
	const undoSent = useUndoSent({
		status,
		onUndoTurn: options.onUndoTurn,
		invoke,
		localRef,
		latest,
		dispatch,
	});

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
