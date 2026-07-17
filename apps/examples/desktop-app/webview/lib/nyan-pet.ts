export const NYAN_PET_STORAGE_KEY = "cline-nyan-pet-gif";
const NYAN_PET_CHANGE_EVENT = "cline:nyan-pet-changed";

/** Bundled default pet, served from webview/public. */
export const DEFAULT_NYAN_PET_SRC = "/nyancat.gif";

/**
 * Upper bound on an uploaded pet. localStorage caps around ~5 MB per origin and
 * base64 inflates bytes by ~33%, so keep the raw file comfortably under that.
 */
export const MAX_NYAN_PET_BYTES = 3 * 1024 * 1024;

/** The custom pet data URL the user uploaded, or null when using the default. */
export function readStoredPetGif(): string | null {
	if (typeof window === "undefined") {
		return null;
	}
	try {
		return window.localStorage.getItem(NYAN_PET_STORAGE_KEY);
	} catch {
		return null;
	}
}

/** The image source the pet should render — custom upload or bundled default. */
export function getNyanPetSrc(): string {
	return readStoredPetGif() ?? DEFAULT_NYAN_PET_SRC;
}

/**
 * Persist (or clear, when passed null) the custom pet and notify live listeners.
 * Throws if the value exceeds the localStorage quota — callers should validate
 * size first and surface a friendly error.
 */
export function setStoredPetGif(dataUrl: string | null): void {
	if (typeof window === "undefined") {
		return;
	}
	if (dataUrl) {
		window.localStorage.setItem(NYAN_PET_STORAGE_KEY, dataUrl);
	} else {
		window.localStorage.removeItem(NYAN_PET_STORAGE_KEY);
	}
	window.dispatchEvent(new CustomEvent(NYAN_PET_CHANGE_EVENT));
}

/**
 * Subscribe to pet changes from this tab (settings edits) or another one
 * (native `storage` event). Returns a cleanup function.
 */
export function subscribeNyanPet(listener: () => void): () => void {
	if (typeof window === "undefined") {
		return () => {};
	}
	const handle = () => listener();
	window.addEventListener(NYAN_PET_CHANGE_EVENT, handle);
	window.addEventListener("storage", handle);
	return () => {
		window.removeEventListener(NYAN_PET_CHANGE_EVENT, handle);
		window.removeEventListener("storage", handle);
	};
}
