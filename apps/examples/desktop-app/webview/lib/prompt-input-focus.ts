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

/**
 * Same pattern for inserting text: whoever owns the active composer's draft
 * appends `text` and focuses the input. Used for editor selections handed
 * over by a host ("Add to Cline" in VS Code).
 */
const APPEND_PROMPT_INPUT_EVENT = "cline:append-prompt-input";

export function requestPromptInputAppend(text: string): void {
	if (typeof window === "undefined" || !text) {
		return;
	}
	window.dispatchEvent(
		new CustomEvent<string>(APPEND_PROMPT_INPUT_EVENT, { detail: text }),
	);
}

export function subscribeToPromptInputAppend(
	listener: (text: string) => void,
): () => void {
	const handler = (event: Event) => {
		const text = (event as CustomEvent<unknown>).detail;
		if (typeof text === "string" && text) listener(text);
	};
	window.addEventListener(APPEND_PROMPT_INPUT_EVENT, handler);
	return () => window.removeEventListener(APPEND_PROMPT_INPUT_EVENT, handler);
}
