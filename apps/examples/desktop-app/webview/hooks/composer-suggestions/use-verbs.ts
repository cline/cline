"use client";

import {
	type ComposerSuggestionItem,
	type ComposerSuggestionsStatus,
	type PluginUiInput,
	SUGGESTION_SEND_VERDICT_MS,
	type SuggestionRef,
	type SuggestionsLocal,
} from "@cline/shared/browser";
import {
	type Dispatch,
	type RefObject,
	type SetStateAction,
	useCallback,
	useRef,
} from "react";
import { type SendSnapshot, snapshotAtSend } from "./sent-prompt";
import { delay, msSinceExposed } from "./timing";
import type {
	ComposerSuggestionsOptions,
	LastSkip,
	ReadyView,
	SuggestionComposer,
	SuggestionsDispatch,
	SuggestionsInvoke,
	SuggestionsResult,
} from "./types";

const SERVED_STATUSES: ReadonlySet<ComposerSuggestionsStatus> = new Set([
	"ready",
	"empty",
	"exhausted",
]);

/**
 * A plugin may answer "more" on the last row by dropping that row or by
 * serving other rows. Only a served set that still offers the rows above it
 * but not that row makes it the Undo skip target.
 */
function answeredAsSkip(
	result: SuggestionsResult | undefined,
	itemId: string,
	rowsAbove: readonly string[],
): boolean {
	const set = result?.outcome === "ok" ? result.state?.state : undefined;
	if (!set || !SERVED_STATUSES.has(set.status)) return false;
	const offered = new Set(set.items.map((row) => row.id));
	return !offered.has(itemId) && rowsAbove.every((id) => offered.has(id));
}

export function useSuggestionVerbs({
	invoke,
	boundRef,
	localRef,
	latest,
	dispatch,
	lastSkip,
	setLastSkip,
	setSendingItemId,
	sendSnapshotRef,
}: {
	invoke: SuggestionsInvoke;
	boundRef: RefObject<string>;
	localRef: RefObject<SuggestionsLocal>;
	latest: RefObject<ComposerSuggestionsOptions>;
	dispatch: SuggestionsDispatch;
	lastSkip: LastSkip | undefined;
	setLastSkip: Dispatch<SetStateAction<LastSkip | undefined>>;
	setSendingItemId: Dispatch<SetStateAction<string | undefined>>;
	sendSnapshotRef: RefObject<SendSnapshot>;
}) {
	/** A one-key Send is waiting for its verdict; another press then sends nothing. */
	const sendInFlightRef = useRef(false);

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
		[invoke, localRef],
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
		[boundRef, dispatch, invoke, localRef],
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
			const attachedAtPress = latest.current.pendingAttachments;
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
				const { messages, onSend, pendingAttachments } = latest.current;
				const attachments = pendingAttachments.filter((file) =>
					attachedAtPress.includes(file),
				);
				sendSnapshotRef.current = snapshotAtSend(messages, attachments);
				onSend(ref.prompt, attachments);
				dispatch({ type: "sent", ref });
			} finally {
				sendInFlightRef.current = false;
				setSendingItemId(undefined);
			}
		},
		[
			boundRef,
			dispatch,
			invoke,
			latest,
			localRef,
			sendSnapshotRef,
			setSendingItemId,
			signalInert,
		],
	);

	const skip = useCallback(
		(view: ReadyView, item: ComposerSuggestionItem, input: PluginUiInput) => {
			const current = localRef.current;
			const revision = current.envelope?.state?.revision;
			if (!revision) return;
			const at = Date.now();
			if (view.skipMeans === "more") {
				dispatch({ type: "refresh_pending", now: at });
				const boundSessionId = boundRef.current;
				const rowsAbove = view.rows
					.map((row) => row.item.id)
					.filter((id) => id !== item.id);
				void invoke({ verb: "refresh", revision, input, cause: "more" }).then(
					(result) => {
						if (boundRef.current !== boundSessionId) return;
						if (answeredAsSkip(result, item.id, rowsAbove)) {
							setLastSkip({ revision, itemId: item.id });
						}
					},
				);
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
		[boundRef, dispatch, invoke, localRef, setLastSkip],
	);

	const refresh = useCallback(
		(input: PluginUiInput) => {
			const revision = localRef.current.envelope?.state?.revision;
			if (!revision) return;
			dispatch({ type: "refresh_pending", now: Date.now() });
			void invoke({ verb: "refresh", revision, input, cause: "new_set" });
		},
		[dispatch, invoke, localRef],
	);

	const unskip = useCallback(
		(input: PluginUiInput) => {
			if (!lastSkip) return;
			setLastSkip(undefined);
			void invoke({ verb: "unskip", ...lastSkip, input });
		},
		[invoke, lastSkip, setLastSkip],
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
		[dispatch, invoke, localRef],
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
		[invoke, localRef],
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
	}, [dispatch, invoke, localRef]);

	const clear = useCallback(
		(_input: PluginUiInput, composer: SuggestionComposer) => {
			if (!localRef.current.used) return;
			composer.setDraft("");
			draftCleared();
		},
		[draftCleared, localRef],
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
			sendSnapshotRef.current = snapshotAtSend(
				latest.current.messages,
				latest.current.pendingAttachments,
			);
			dispatch({ type: "sent" });
		},
		[dispatch, invoke, latest, localRef, sendSnapshotRef],
	);

	const move = useCallback(
		(delta: 1 | -1) => {
			dispatch({ type: "move", delta });
		},
		[dispatch],
	);

	const highlight = useCallback(
		(itemId: string) => {
			dispatch({ type: "highlight", itemId });
		},
		[dispatch],
	);

	return {
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
	};
}
