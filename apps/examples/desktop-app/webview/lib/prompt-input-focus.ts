/**
 * Tiny cross-tree signal for focusing the chat prompt input. The sidebar's
 * "New" action lives far from the chat pane, so instead of threading a focus
 * callback through the whole component chain it dispatches a window event
 * that the mounted prompt input listens for.
 */

const FOCUS_PROMPT_INPUT_EVENT = "cline:focus-prompt-input";

export function requestPromptInputFocus(): void {
	if (typeof window === "undefined") {
		return;
	}
	// Deferred so a focus request issued alongside a navigation (e.g. the New
	// button remounting the chat pane) reaches the freshly mounted input.
	window.setTimeout(() => {
		window.dispatchEvent(new Event(FOCUS_PROMPT_INPUT_EVENT));
	}, 0);
}

export function subscribeToPromptInputFocus(listener: () => void): () => void {
	window.addEventListener(FOCUS_PROMPT_INPUT_EVENT, listener);
	return () => window.removeEventListener(FOCUS_PROMPT_INPUT_EVENT, listener);
}
