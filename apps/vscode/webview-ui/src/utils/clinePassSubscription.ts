const DEFAULT_CLINE_APP_BASE_URL = "https://app.cline.bot"
const CLINE_PASS_SUBSCRIPTION_PATH = "dashboard/subscription"

export function buildClinePassSubscriptionUrl(appBaseUrl?: string): string {
	try {
		const baseUrl = appBaseUrl || DEFAULT_CLINE_APP_BASE_URL
		const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`
		const url = new URL(CLINE_PASS_SUBSCRIPTION_PATH, base)
		url.searchParams.set("personal", "true")
		return url.toString()
	} catch {
		return `${DEFAULT_CLINE_APP_BASE_URL}/${CLINE_PASS_SUBSCRIPTION_PATH}?personal=true`
	}
}
