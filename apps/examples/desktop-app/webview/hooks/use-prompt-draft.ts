import {
	type SetStateAction,
	useCallback,
	useLayoutEffect,
	useRef,
	useState,
} from "react";

export type PromptDraft = {
	text: string;
	attachments: File[];
};

export class PromptDraftCache extends Map<string, PromptDraft> {
	private readonly listeners = new Set<
		(threadId: string, draft: PromptDraft) => void
	>();

	subscribe(listener: (threadId: string, draft: PromptDraft) => void) {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	restore(
		threadId: string,
		expected: PromptDraft,
		draft: PromptDraft,
	): boolean {
		if (this.get(threadId) !== expected) return false;
		this.set(threadId, draft);
		for (const listener of this.listeners) listener(threadId, draft);
		return true;
	}
}

/**
 * Keeps drafts outside the keyed chat pane so navigation can safely unmount it.
 * Keystrokes only update the ref/cache; external edits also update the composer.
 * The caller remounts this hook when the thread changes.
 */
export function usePromptDraft(drafts: PromptDraftCache, threadId: string) {
	const draftRef = useRef<PromptDraft>(
		drafts.get(threadId) ?? { text: "", attachments: [] },
	);
	const [pendingAttachments, setAttachments] = useState(
		draftRef.current.attachments,
	);
	const mountedRef = useRef(true);
	const revisionRef = useRef(0);
	useLayoutEffect(() => {
		drafts.set(threadId, draftRef.current);
		mountedRef.current = true;
		const unsubscribe = drafts.subscribe((restoredThreadId, restored) => {
			if (restoredThreadId !== threadId) return;
			draftRef.current = restored;
			revisionRef.current += 1;
			setAttachments(restored.attachments);
			setPromptDraft((prev) => ({
				version: prev.version + 1,
				value: restored.text,
			}));
		});
		return () => {
			unsubscribe();
			mountedRef.current = false;
			revisionRef.current += 1;
		};
	}, [drafts, threadId]);
	const setPendingAttachments = useCallback(
		(update: SetStateAction<File[]>) => {
			if (!mountedRef.current) return;
			const next =
				typeof update === "function"
					? update(draftRef.current.attachments)
					: update;
			draftRef.current = { ...draftRef.current, attachments: next };
			drafts.set(threadId, draftRef.current);
			setAttachments(next);
		},
		[drafts, threadId],
	);
	const [promptDraft, setPromptDraft] = useState(() => ({
		version: 0,
		value: draftRef.current.text,
	}));
	const handlePromptInputChange = useCallback(
		(value: string) => {
			if (!mountedRef.current) return;
			// The composer echoes external replacements. Those acknowledgements
			// aren't new edits and must not invalidate a pending send's recovery.
			if (draftRef.current.text === value) return;
			revisionRef.current += 1;
			draftRef.current = { ...draftRef.current, text: value };
			drafts.set(threadId, draftRef.current);
		},
		[drafts, threadId],
	);
	const setPromptInput = useCallback(
		(value: string) => {
			if (!mountedRef.current) return;
			// Even an equal-valued external replacement supersedes pending work.
			revisionRef.current += 1;
			draftRef.current = { ...draftRef.current, text: value };
			drafts.set(threadId, draftRef.current);
			setPromptDraft((prev) => ({ version: prev.version + 1, value }));
		},
		[drafts, threadId],
	);
	const clearPromptForSend = useCallback(() => {
		setPromptInput("");
		const revision = revisionRef.current;
		return (rejectedPrompt: string): boolean => {
			if (
				!mountedRef.current ||
				revisionRef.current !== revision ||
				draftRef.current.text.trim() !== ""
			) {
				return false;
			}
			setPromptInput(rejectedPrompt);
			return true;
		};
	}, [setPromptInput]);
	const clearDraftForHandoff = useCallback(
		(text: string) => {
			const rejectedDraft = { text, attachments: draftRef.current.attachments };
			setPendingAttachments([]);
			setPromptInput("");
			const cleared = draftRef.current;
			return () => drafts.restore(threadId, cleared, rejectedDraft);
		},
		[drafts, setPendingAttachments, setPromptInput, threadId],
	);

	return {
		draftRef,
		pendingAttachments,
		setPendingAttachments,
		promptDraft,
		setPromptInput,
		handlePromptInputChange,
		clearPromptForSend,
		clearDraftForHandoff,
	};
}
