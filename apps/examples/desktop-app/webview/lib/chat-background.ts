export const CHAT_BACKGROUND_STORAGE_KEY = "cline-chat-background";
const CHAT_BACKGROUND_CHANGE_EVENT = "cline:chat-background-changed";

/**
 * Upper bound on the uploaded background. localStorage caps around ~5 MB per
 * origin and base64 inflates bytes by ~33%, so keep the raw file under that
 * (shared with the pet gif, so leave headroom for both).
 */
export const MAX_CHAT_BACKGROUND_BYTES = 3 * 1024 * 1024;

/** The custom chat background data URL, or null when none is set. */
export function readChatBackground(): string | null {
	if (typeof window === "undefined") {
		return null;
	}
	try {
		return window.localStorage.getItem(CHAT_BACKGROUND_STORAGE_KEY);
	} catch {
		return null;
	}
}

/**
 * Persist (or clear, when passed null) the chat background and notify listeners.
 * Throws if the value exceeds the localStorage quota — callers should validate
 * size first and surface a friendly error.
 */
export function setChatBackground(dataUrl: string | null): void {
	if (typeof window === "undefined") {
		return;
	}
	if (dataUrl) {
		window.localStorage.setItem(CHAT_BACKGROUND_STORAGE_KEY, dataUrl);
	} else {
		window.localStorage.removeItem(CHAT_BACKGROUND_STORAGE_KEY);
	}
	window.dispatchEvent(new CustomEvent(CHAT_BACKGROUND_CHANGE_EVENT));
}

/**
 * Subscribe to background changes from this tab (settings edits) or another one
 * (native `storage` event). Returns a cleanup function.
 */
export function subscribeChatBackground(listener: () => void): () => void {
	if (typeof window === "undefined") {
		return () => {};
	}
	const handle = () => listener();
	window.addEventListener(CHAT_BACKGROUND_CHANGE_EVENT, handle);
	window.addEventListener("storage", handle);
	return () => {
		window.removeEventListener(CHAT_BACKGROUND_CHANGE_EVENT, handle);
		window.removeEventListener("storage", handle);
	};
}
