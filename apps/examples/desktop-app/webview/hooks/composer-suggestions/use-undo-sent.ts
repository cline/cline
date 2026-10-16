"use client";

import {
	SUGGESTION_SEND_VERDICT_MS,
	type SuggestionsLocal,
} from "@cline/shared/browser";
import { type RefObject, useCallback, useRef } from "react";
import { BUSY_STATUSES } from "@/hooks/use-chat-session";
import { toast } from "@/hooks/use-toast";
import type { ChatSessionStatus } from "@/lib/chat-schema";
import { findSentMessage, samePrompt, takenBackDraft } from "./sent-prompt";
import { delay } from "./timing";
import type {
	ComposerSuggestionsOptions,
	SuggestionComposer,
	SuggestionsDispatch,
	SuggestionsInvoke,
} from "./types";

/** ⌘3 waits this long for a stopped run to go idle before it forks. */
const STOP_WAIT_MS = 5_000;
const STOP_POLL_MS = 50;
const STILL_STOPPING = "Still stopping — try again";
/** The queue would not give the prompt back: it already started, or the sidecar does not know its id yet. */
const NOT_TAKEN_BACK = "Couldn't take it back yet — try again";

export function useUndoSent({
	status,
	onUndoTurn,
	invoke,
	localRef,
	latest,
	dispatch,
}: {
	status: ChatSessionStatus;
	onUndoTurn: ComposerSuggestionsOptions["onUndoTurn"];
	invoke: SuggestionsInvoke;
	localRef: RefObject<SuggestionsLocal>;
	latest: RefObject<ComposerSuggestionsOptions>;
	dispatch: SuggestionsDispatch;
}) {
	const statusRef = useRef(status);
	statusRef.current = status;
	const onUndoTurnRef = useRef(onUndoTurn);
	onUndoTurnRef.current = onUndoTurn;
	/** An Undo is taking the sent prompt back; another press then does nothing. */
	const undoInFlightRef = useRef(false);

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
		[dispatch, invoke, latest, localRef],
	);

	return undoSent;
}
