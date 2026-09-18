export const FEATURE_ANNOUNCEMENTS_STORAGE_KEY =
	"cline.code.feature-announcements.v1";

/**
 * One-time feature spotlights shown to existing users after an update. Add an
 * id here and gate the dialog on `claimFeatureAnnouncement` so it opens once
 * per install and never stacks on top of first-run onboarding.
 */
export type FeatureAnnouncementId = "ssh-remote-environments";

export type FeatureAnnouncementStorage = {
	/** Announcement id → ISO timestamp of when it was shown. */
	seen: Partial<Record<FeatureAnnouncementId, string>>;
};

export function parseFeatureAnnouncementStorage(
	raw: string | null,
): FeatureAnnouncementStorage {
	if (!raw) {
		return { seen: {} };
	}
	try {
		const parsed = JSON.parse(raw) as { seen?: unknown };
		const seen =
			parsed && typeof parsed === "object" && !Array.isArray(parsed)
				? parsed.seen
				: undefined;
		if (!seen || typeof seen !== "object" || Array.isArray(seen)) {
			return { seen: {} };
		}
		const entries = Object.entries(seen as Record<string, unknown>).filter(
			(entry): entry is [string, string] =>
				typeof entry[1] === "string" && entry[1].trim().length > 0,
		);
		return { seen: Object.fromEntries(entries) };
	} catch {
		return { seen: {} };
	}
}

export function hasSeenFeatureAnnouncement(id: FeatureAnnouncementId): boolean {
	if (typeof window === "undefined") {
		return true;
	}
	try {
		return (
			parseFeatureAnnouncementStorage(
				window.localStorage.getItem(FEATURE_ANNOUNCEMENTS_STORAGE_KEY),
			).seen[id] !== undefined
		);
	} catch {
		// Unreadable storage (private mode, disabled storage) would otherwise
		// re-show the spotlight on every launch; treat it as already seen.
		return true;
	}
}

export function markFeatureAnnouncementSeen(id: FeatureAnnouncementId): void {
	if (typeof window === "undefined") {
		return;
	}
	try {
		const storage = parseFeatureAnnouncementStorage(
			window.localStorage.getItem(FEATURE_ANNOUNCEMENTS_STORAGE_KEY),
		);
		storage.seen[id] = new Date().toISOString();
		window.localStorage.setItem(
			FEATURE_ANNOUNCEMENTS_STORAGE_KEY,
			JSON.stringify(storage),
		);
	} catch {
		// The spotlight replays next launch; nothing else breaks.
	}
}

/**
 * Decides at launch whether a spotlight should open, and records it as shown
 * when it does. A fresh install is walked through onboarding instead — the
 * feature is simply part of the app for them — so the spotlight is marked
 * seen rather than queued up behind the first-run flow.
 */
export function claimFeatureAnnouncement(
	id: FeatureAnnouncementId,
	{ onboardingCompleted }: { onboardingCompleted: boolean },
): boolean {
	if (hasSeenFeatureAnnouncement(id)) {
		return false;
	}
	markFeatureAnnouncementSeen(id);
	return onboardingCompleted;
}
