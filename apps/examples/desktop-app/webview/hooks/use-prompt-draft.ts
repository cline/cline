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
		drafts.get(threadId) ?? { text: "", attachments: [] },
	);
	const promptInputRef = useRef(draftRef.current.text);
	const [pendingAttachments, setAttachments] = useState(
		draftRef.current.attachments,
	);
	const mountedRef = useRef(true);
	const revisionRef = useRef(0);
	useLayoutEffect(() => {
		drafts.set(threadId, draftRef.current);
		mountedRef.current = true;
		return () => {
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
		if (promptInputRef.current !== value) revisionRef.current += 1;
		promptInputRef.current = value;
		draftRef.current.text = value;
	}, []);
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

	return {
		draftRef,
		pendingAttachments,
		setPendingAttachments,
		promptInputRef,
		promptDraft,
		setPromptInput,
		handlePromptInputChange,
		clearPromptForSend,
	};
}
