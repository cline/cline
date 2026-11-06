/**
 * Tiny cross-tree signal for focusing the chat prompt input. The sidebar's
 * "New" action lives far from the chat pane, so instead of threading a focus
 * callback through the whole component chain it dispatches a window event
 * that the mounted prompt input listens for.
 */

const FOCUS_PROMPT_INPUT_EVENT = "cline:focus-prompt-input";

export function requestPromptInputFocus(composerId: string): void {
	if (typeof window === "undefined") return;
	// Navigation may mount the addressed composer in the next render.
	window.setTimeout(() => {
		window.dispatchEvent(
			new CustomEvent(FOCUS_PROMPT_INPUT_EVENT, { detail: composerId }),
		);
	}, 0);
}

export function subscribeToPromptInputFocus(
	composerId: string,
	listener: () => void,
): () => void {
	const handleFocus = (event: Event) => {
		if (event instanceof CustomEvent && event.detail === composerId) listener();
	};
	window.addEventListener(FOCUS_PROMPT_INPUT_EVENT, handleFocus);
	return () =>
		window.removeEventListener(FOCUS_PROMPT_INPUT_EVENT, handleFocus);
}
