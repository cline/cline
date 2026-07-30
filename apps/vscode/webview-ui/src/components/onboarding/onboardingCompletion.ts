import { StateServiceClient } from "@/services/grpc-client"

type PendingOnboardingCompletion = {
	step: number
	page: string
	userType?: string
	modelSelected?: string
}

// Module-level so the pending intent survives OnboardingView unmounting: once OAuth
// succeeds the host sets welcomeViewCompleted, which unmounts onboarding in the same
// state update that precedes the auth-status event carrying clineUser. Mirrors the
// pendingClinePassSubscribe pattern in clinePassSubscribe.ts.
let pendingOnboardingCompletion: PendingOnboardingCompletion | null = null

export function setPendingOnboardingCompletion(value: PendingOnboardingCompletion | null): void {
	pendingOnboardingCompletion = value
}

/** Fires the onboarding "completed" funnel event once a pending OAuth signup/signin authenticates (guarded so it fires once). */
export function captureOnboardingCompletionIfPending(): void {
	if (!pendingOnboardingCompletion) {
		return
	}
	const payload = pendingOnboardingCompletion
	pendingOnboardingCompletion = null
	StateServiceClient.captureOnboardingProgress({
		step: payload.step,
		action: "completed",
		page: payload.page,
		userType: payload.userType,
		modelSelected: payload.modelSelected,
		completed: true,
	}).catch((err) => console.error("Failed to capture onboarding completion:", err))
}
