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
	revision: number;
	handoffFollowUpId?: string;
	lastRestoredFollowUpId?: string;
	restoredHandoffRetry?: {
		sourceSessionId: string;
		draft?: string;
		attachments?: File[];
	};
};

/**
 * Keeps drafts outside the keyed chat pane so navigation can safely unmount it.
 * Keystrokes only update the ref/cache; external edits also update the composer.
 * The caller remounts this hook when the thread changes.
 */
export function usePromptDraft(
	drafts: Map<string, PromptDraft>,
	threadId: string,
) {
	const draftRef = useRef<PromptDraft>(
		drafts.get(threadId) ?? { text: "", attachments: [], revision: 0 },
	);
	const promptInputRef = useRef(draftRef.current.text);
	const [pendingAttachments, setAttachments] = useState(
		draftRef.current.attachments,
	);
	const mountedRef = useRef(true);
	useLayoutEffect(() => {
		drafts.set(threadId, draftRef.current);
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
		};
	}, [drafts, threadId]);
	const setPendingAttachments = useCallback(
		(update: SetStateAction<File[]>) => {
			if (!mountedRef.current) return;
			const next =
				typeof update === "function"
					? update(draftRef.current.attachments)
					: update;
			if (next !== draftRef.current.attachments) draftRef.current.revision += 1;
			draftRef.current.attachments = next;
			setAttachments(next);
		},
		[],
	);
	const [promptDraft, setPromptDraft] = useState(() => ({
		version: 0,
		value: promptInputRef.current,
	}));
	const handlePromptInputChange = useCallback((value: string) => {
		if (!mountedRef.current) return;
		// The composer echoes external replacements. Those acknowledgements
		// aren't new edits and must not invalidate a pending send's recovery.
		if (promptInputRef.current !== value) draftRef.current.revision += 1;
		promptInputRef.current = value;
		draftRef.current.text = value;
	}, []);
	const setPromptInput = useCallback(
		(value: string) => {
			if (!mountedRef.current) return;
			// Even an equal-valued external replacement supersedes pending work.
			draftRef.current.revision += 1;
			handlePromptInputChange(value);
			setPromptDraft((prev) => ({ version: prev.version + 1, value }));
		},
		[handlePromptInputChange],
	);
	const restoreHandoffRetry = useCallback(
		(retry: PromptDraft["restoredHandoffRetry"]) => {
			const restored = draftRef.current.restoredHandoffRetry;
			if (!retry) {
				draftRef.current.restoredHandoffRetry = undefined;
				return false;
			}
			if (
				restored?.sourceSessionId === retry.sourceSessionId &&
				restored.draft === retry.draft &&
				restored.attachments === retry.attachments
			)
				return false;
			draftRef.current.restoredHandoffRetry = retry;
			if (retry.draft) setPromptInput(retry.draft);
			if (retry.attachments?.length)
				setPendingAttachments([...retry.attachments]);
			return true;
		},
		[setPromptInput, setPendingAttachments],
	);
	const clearPromptForSend = useCallback(() => {
		setPromptInput("");
		const revision = draftRef.current.revision;
		return (rejectedPrompt?: string): boolean => {
			if (
				drafts.get(threadId) !== draftRef.current ||
				draftRef.current.revision !== revision ||
				draftRef.current.text.trim() !== ""
			) {
				return false;
			}
			// Once sending settles, a later open can consult the durable recovery copy.
			draftRef.current.lastRestoredFollowUpId = undefined;
			if (rejectedPrompt === undefined || !mountedRef.current) return false;
			setPromptInput(rejectedPrompt);
			return true;
		};
	}, [drafts, threadId, setPromptInput]);

	return {
		draftRef,
		pendingAttachments,
		setPendingAttachments,
		restoreHandoffRetry,
		promptInputRef,
		promptDraft,
		setPromptInput,
		handlePromptInputChange,
		clearPromptForSend,
	};
}
