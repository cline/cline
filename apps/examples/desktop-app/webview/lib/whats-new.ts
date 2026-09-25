import { WHATS_NEW_RELEASES, type WhatsNewRelease } from "./whats-new-content";

export const WHATS_NEW_STORAGE_KEY = "cline.code.whats-new.v1";

export function latestWhatsNew(): WhatsNewRelease | null {
	return WHATS_NEW_RELEASES[0] ?? null;
}

export function readSeenWhatsNewId(): string | null {
	if (typeof window === "undefined") {
		return null;
	}
	try {
		return window.localStorage.getItem(WHATS_NEW_STORAGE_KEY);
	} catch {
		// Unreadable storage (private mode, disabled storage) counts as seen,
		// matching onboarding, so the dialog can't reappear on every launch.
		return latestWhatsNew()?.id ?? null;
	}
}

export function markWhatsNewSeen(id: string): void {
	if (typeof window === "undefined") {
		return;
	}
	try {
		window.localStorage.setItem(WHATS_NEW_STORAGE_KEY, id);
	} catch {
		// Storage unavailable: the dialog shows again next launch, nothing breaks.
	}
}

/** Marks the current catch-up as seen so it never shows to a fresh install. */
export function markCurrentWhatsNewSeen(): void {
	const latest = latestWhatsNew();
	if (latest) {
		markWhatsNewSeen(latest.id);
	}
}

/**
 * The catch-up to show on launch, or null when the user has already seen the
 * latest one (or there is none).
 */
export function pendingWhatsNew(
	seenId: string | null = readSeenWhatsNewId(),
): WhatsNewRelease | null {
	const latest = latestWhatsNew();
	return latest && latest.id !== seenId ? latest : null;
}
