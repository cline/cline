import { useCallback, useLayoutEffect, useState } from "react";
import type { PromptDraftStore } from "@/lib/prompt-draft-store";

/**
 * Connects a keyed chat pane to the app-owned draft store. Keystrokes update
 * the store without rendering the pane; external changes are versioned so the
 * composer applies them even when the stored string is unchanged.
 */
export function usePromptDraft(store: PromptDraftStore, threadId: string) {
	const [promptDraft, setPromptDraft] = useState(() => ({
		version: 0,
		value: store.getDraft(threadId),
	}));
	useLayoutEffect(
		() =>
			store.subscribe(threadId, (value) =>
				setPromptDraft((prev) => ({ version: prev.version + 1, value })),
			),
		[store, threadId],
	);
	const handlePromptInputChange = useCallback(
		(value: string) => store.edit(threadId, value),
		[store, threadId],
	);
	const setPromptInput = useCallback(
		(value: string) => store.replace(threadId, value),
		[store, threadId],
	);
	const beginSend = useCallback(
		(prompt: string, attachments: readonly File[]) =>
			store.beginSend(threadId, prompt, attachments),
		[store, threadId],
	);

	return {
		promptDraft,
		setPromptInput,
		handlePromptInputChange,
		beginSend,
	};
}
