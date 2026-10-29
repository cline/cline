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

/** Puts a failed send's prompt back, but only into a box that is empty and untouched since the send. */
export type RestorePrompt = (value: string) => boolean;

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
	const restorePromptIfUntouched = useCallback((): RestorePrompt => {
		const revision = revisionRef.current;
		return (rejectedPrompt) => {
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
	/**
	 * For a send whose prompt did not come from the box: leaves the box as it is.
	 * The draft takes the box's text under the same version, so the composer does
	 * not re-apply it, but a remounted composer starts from that text and not from
	 * an older injected draft, which may be a prompt already sent.
	 */
	const holdPromptForSend = useCallback((): RestorePrompt => {
		const held = draftRef.current.text;
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
	/** Detaches and returns those of `wanted` still attached; files added since stay. */
	const takePendingAttachments = useCallback(
		(wanted: readonly File[]): File[] => {
			const taken = draftRef.current.attachments.filter((file) =>
				wanted.includes(file),
			);
			setPendingAttachments((current) =>
				current.filter((file) => !taken.includes(file)),
			);
			return taken;
		},
		[setPendingAttachments],
	);
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
		holdPromptForSend,
		clearDraftForHandoff,
		takePendingAttachments,
	};
}
