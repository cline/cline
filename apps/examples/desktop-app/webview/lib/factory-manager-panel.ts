const OPEN_STORAGE_KEY = "cline.code.factory-manager-open.v1";
const SESSION_STORAGE_KEY = "cline.code.factory-manager-session.v1";

function read(key: string): string | null {
	try {
		return window.localStorage.getItem(key);
	} catch {
		return null;
	}
}

function write(key: string, value: string | null): void {
	try {
		if (value === null) window.localStorage.removeItem(key);
		else window.localStorage.setItem(key, value);
	} catch {
		// Not remembering the panel is harmless.
	}
}

/** Whether the docked Ask Factory panel was left open. */
export function readFactoryManagerPanelOpen(): boolean {
	return typeof window !== "undefined" && read(OPEN_STORAGE_KEY) === "1";
}

export function writeFactoryManagerPanelOpen(open: boolean): void {
	write(OPEN_STORAGE_KEY, open ? "1" : null);
}

/** The manager conversation the panel reopens after navigation or a restart. */
export function readFactoryManagerSessionId(): string | null {
	if (typeof window === "undefined") return null;
	return read(SESSION_STORAGE_KEY) || null;
}

export function writeFactoryManagerSessionId(sessionId: string | null): void {
	write(SESSION_STORAGE_KEY, sessionId);
}

/**
 * Names the card the user is looking at as a final prompt line, by short id
 * only: the manager reads its state with `factory_status` rather than trusting
 * a title.
 */
export function withOpenCardLine(prompt: string, shortId?: string): string {
	if (!shortId) return prompt;
	const line = `Open card: ${shortId}`;
	return prompt ? `${prompt}\n\n${line}` : line;
}
