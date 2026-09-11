export const ONBOARDING_STORAGE_KEY = "cline.code.onboarding.v1";

/**
 * Fired on `window` when the onboarding state is reset (e.g. from the
 * "replay new user experience" setting) so the app shell can re-enter the
 * first-run flow without a full reload.
 */
export const ONBOARDING_RESET_EVENT = "cline:onboarding-reset";

export type OnboardingStorage = {
	completedAt: string | null;
};

export function parseOnboardingStorage(raw: string | null): OnboardingStorage {
	if (!raw) {
		return { completedAt: null };
	}
	try {
		const parsed = JSON.parse(raw) as { completedAt?: unknown };
		const completedAt =
			parsed && typeof parsed === "object" && !Array.isArray(parsed)
				? parsed.completedAt
				: undefined;
		return {
			completedAt:
				typeof completedAt === "string" && completedAt.trim().length > 0
					? completedAt
					: null,
		};
	} catch {
		return { completedAt: null };
	}
}

export function hasCompletedOnboarding(): boolean {
	if (typeof window === "undefined") {
		return true;
	}
	try {
		return (
			parseOnboardingStorage(
				window.localStorage.getItem(ONBOARDING_STORAGE_KEY),
			).completedAt !== null
		);
	} catch {
		// Treat unreadable storage (private mode, disabled storage) as
		// completed so the app never traps the user in the first-run flow.
		return true;
	}
}

export function markOnboardingCompleted(): void {
	if (typeof window === "undefined") {
		return;
	}
	try {
		const storage: OnboardingStorage = {
			completedAt: new Date().toISOString(),
		};
		window.localStorage.setItem(
			ONBOARDING_STORAGE_KEY,
			JSON.stringify(storage),
		);
	} catch {
		// Onboarding will replay next launch; nothing else breaks.
	}
}

export function resetOnboarding(): void {
	if (typeof window === "undefined") {
		return;
	}
	try {
		window.localStorage.removeItem(ONBOARDING_STORAGE_KEY);
	} catch {
		// Fall through to the event so an in-app replay still works.
	}
	window.dispatchEvent(new CustomEvent(ONBOARDING_RESET_EVENT));
}
