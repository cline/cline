// Module-level record of banner ids dismissed during this webview session.
// Dismissals are persisted through StateServiceClient.dismissBanner, but that
// round-trip is async; keeping the ids here (outliving component unmounts)
// guarantees a just-dismissed banner can't reappear before the persisted
// dismissedBanners state syncs back from the host.
const sessionDismissedBannerIds = new Set<string>()

export function markBannerDismissedForSession(bannerId: string): void {
	sessionDismissedBannerIds.add(bannerId)
}

export function isBannerDismissedForSession(bannerId: string): boolean {
	return sessionDismissedBannerIds.has(bannerId)
}

export function getSessionDismissedBannerIds(): Set<string> {
	return new Set(sessionDismissedBannerIds)
}

export function clearSessionBannerDismissalsForTesting(): void {
	sessionDismissedBannerIds.clear()
}
