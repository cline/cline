import { useCallback, useLayoutEffect, useRef, useState } from "react";

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
	const clearPromptForSend = useCallback(() => {
		setPromptInput("");
		const revision = revisionRef.current;
		return (value: string): boolean => {
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

	return {
		promptInputRef,
		promptDraft,
		setPromptInput,
		handlePromptInputChange,
		clearPromptForSend,
	};
}
