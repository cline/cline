import VSCodeButtonLink from "@/components/common/VSCodeButtonLink"
import { useClineAuth } from "@/context/ClineAuthContext"

// Fall back to production when the authenticated user's app base URL is unavailable.
const DEFAULT_APP_BASE_URL = "https://app.cline.bot"
// Cline Pass subscribe/manage page in the dashboard.
const CLINE_PASS_SUBSCRIBE_PATH = "/dashboard/plan"

/**
 * Optional subscribe affordance shown after a new user picks Cline Pass and
 * starts account creation. The account login itself is the existing OAuth flow;
 * this only surfaces a link to the dashboard subscribe page so the user can
 * activate Cline Pass. Purely additive — it does not change the onboarding flow.
 */
export const ClinePassSubscribeCallout = () => {
	const { clineUser } = useClineAuth()
	// Use the environment-aware app base URL (e.g. staging-app.cline.bot on staging)
	// so the subscribe link points at the same environment the user signs into.
	const appBaseUrl = clineUser?.appBaseUrl || DEFAULT_APP_BASE_URL
	const subscribeUrl = `${appBaseUrl}${CLINE_PASS_SUBSCRIBE_PATH}`

	return (
		<div className="flex w-full max-w-lg flex-col gap-2 my-2 items-center">
			<p className="text-foreground/70 text-sm text-center m-0">
				Activate Cline Pass to unlock curated models — no API keys to manage.
			</p>
			<VSCodeButtonLink className="w-full" href={subscribeUrl}>
				<span className="codicon codicon-rocket mr-[6px] text-[14px]" />
				Get Cline Pass
			</VSCodeButtonLink>
		</div>
	)
}
