import { StringRequest } from "@shared/proto/cline/common"
import { UiServiceClient } from "@/services/grpc-client"

// ClinePass subscription signup page in the dashboard (requires auth).
// Relative (no leading slash) so paths append to path-prefixed app URLs (e.g. self-hosted/proxy) instead of resetting to origin.
const CLINE_PASS_SUBSCRIBE_PATH = "onboarding/individual-plan"
const CLINE_PASS_USAGE_PATH = "dashboard/subscription"
export const DEFAULT_APP_BASE_URL = "https://app.cline.bot"

function buildAppUrl(appBaseUrl: string | undefined, path: string): string {
	const baseUrl = appBaseUrl || DEFAULT_APP_BASE_URL
	const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`
	return new URL(path, base).toString()
}

// Module-level so the pending intent survives OnboardingView unmounting: handleAuthCallback
// completes the welcome view (unmounting onboarding) before it pushes the auth-status update
// that sets clineUser, so this must outlive the component to fire the redirect.
let pendingClinePassSubscribe = false

export function setPendingClinePassSubscribe(pending: boolean): void {
	pendingClinePassSubscribe = pending
}

// Opens the ClinePass subscription page once a pending signup is authenticated (guarded so it fires once).
export function openClinePassSubscriptionIfPending(appBaseUrl: string | undefined): void {
	if (!pendingClinePassSubscribe) {
		return
	}
	pendingClinePassSubscribe = false
	UiServiceClient.openUrl(StringRequest.create({ value: buildClinePassSubscribeUrl(appBaseUrl) })).catch((err) =>
		console.error("Failed to open ClinePass subscription page:", err),
	)
}

export function buildClinePassSubscriptionPageUrl(appBaseUrl: string | undefined): string {
	return buildAppUrl(appBaseUrl, CLINE_PASS_USAGE_PATH)
}

// Signup/subscribe page for users who don't have a ClinePass subscription yet.
export function buildClinePassSubscribeUrl(appBaseUrl: string | undefined): string {
	return buildAppUrl(appBaseUrl, CLINE_PASS_SUBSCRIBE_PATH)
}
