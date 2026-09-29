import { useCallback, useRef, useState } from "react";

/**
 * Keeps drafts outside the keyed chat pane so navigation can safely unmount it.
 * Keystrokes only update the ref/cache; external edits also update the composer.
 * The caller remounts this hook when the thread changes.
 */
export function usePromptDraft(drafts: Map<string, string>, threadId: string) {
	const promptInputRef = useRef(drafts.get(threadId) ?? "");
	const [promptDraft, setPromptDraft] = useState(() => ({
		version: 0,
		value: promptInputRef.current,
	}));
	const handlePromptInputChange = useCallback(
		(value: string) => {
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
			handlePromptInputChange(value);
			setPromptDraft((prev) => ({ version: prev.version + 1, value }));
		},
		[handlePromptInputChange],
	);

	return {
		promptInputRef,
		promptDraft,
		setPromptInput,
		handlePromptInputChange,
	};
}
