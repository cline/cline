import { StringRequest } from "@shared/proto/cline/common"
import { UiServiceClient } from "@/services/grpc-client"

// ClinePass subscription signup page in the dashboard (requires auth).
const CLINE_PASS_SUBSCRIBE_PATH = "/onboarding/individual-plan"
const CLINE_PASS_USAGE_PATH = "/dashboard/subscription"
export const DEFAULT_APP_BASE_URL = "https://app.cline.bot"

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
	const baseUrl = appBaseUrl || DEFAULT_APP_BASE_URL
	UiServiceClient.openUrl(StringRequest.create({ value: `${baseUrl}${CLINE_PASS_SUBSCRIBE_PATH}` })).catch((err) =>
		console.error("Failed to open ClinePass subscription page:", err),
	)
}

export function buildClinePassSubscriptionPageUrl(appBaseUrl: string | undefined): string {
	return new URL(CLINE_PASS_USAGE_PATH, appBaseUrl || DEFAULT_APP_BASE_URL).toString()
}
