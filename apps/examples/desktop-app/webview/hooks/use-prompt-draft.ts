import { useCallback, useLayoutEffect, useRef, useState } from "react";

/** Puts a failed send's prompt back, but only into a box that is empty and untouched since the send. */
export type RestorePrompt = (value: string) => boolean;

/**
 * Keeps drafts outside the keyed chat pane so navigation can safely unmount it.
 * Keystrokes only update the ref/cache; external edits also update the composer.
 * The caller remounts this hook when the thread changes.
 */
export function usePromptDraft(drafts: Map<string, string>, threadId: string) {
	const promptInputRef = useRef(drafts.get(threadId) ?? "");
	const mountedRef = useRef(true);
	const revisionRef = useRef(0);
	useLayoutEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
			revisionRef.current += 1;
		};
	}, []);
	const [promptDraft, setPromptDraft] = useState(() => ({
		version: 0,
		value: promptInputRef.current,
	}));
	const handlePromptInputChange = useCallback(
		(value: string) => {
			if (!mountedRef.current) return;
			// The composer echoes external replacements. Those acknowledgements
			// aren't new edits and must not invalidate a pending send's recovery.
			if (promptInputRef.current !== value) revisionRef.current += 1;
			promptInputRef.current = value;
			if (value) {
				drafts.set(threadId, value);
			} else {
				drafts.delete(threadId);
			}
		},
		[drafts, threadId],
	);
	const setPromptInput = useCallback(
		(value: string) => {
			if (!mountedRef.current) return;
			// Even an equal-valued external replacement supersedes pending work.
			revisionRef.current += 1;
			handlePromptInputChange(value);
			setPromptDraft((prev) => ({ version: prev.version + 1, value }));
		},
		[handlePromptInputChange],
	);
	const restorePromptIfUntouched = useCallback((): RestorePrompt => {
		const revision = revisionRef.current;
		return (value) => {
			if (
				!mountedRef.current ||
				revisionRef.current !== revision ||
				promptInputRef.current.trim() !== ""
			) {
				return false;
			}
			setPromptInput(value);
			return true;
		};
	}, [setPromptInput]);
	/**
	 * For a send whose prompt did not come from the box: leaves the box as it is.
	 * The draft takes the box's text under the same version, so the composer does
	 * not re-apply it, but a remounted composer starts from that text and not from
	 * an older injected draft, which may be a prompt already sent.
	 */
	const holdPromptForSend = useCallback((): RestorePrompt => {
		const held = promptInputRef.current;
		if (mountedRef.current) {
			setPromptDraft((prev) =>
				prev.value === held ? prev : { version: prev.version, value: held },
			);
		}
		return restorePromptIfUntouched();
	}, [restorePromptIfUntouched]);
	const clearPromptForSend = useCallback((): RestorePrompt => {
		setPromptInput("");
		return restorePromptIfUntouched();
	}, [restorePromptIfUntouched, setPromptInput]);

	return {
		promptInputRef,
		promptDraft,
		setPromptInput,
		handlePromptInputChange,
		clearPromptForSend,
		holdPromptForSend,
	};
}
