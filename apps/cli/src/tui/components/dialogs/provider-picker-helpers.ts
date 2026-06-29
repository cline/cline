const CLINE_PASS_SUBSCRIPTION_PATH = "/dashboard/subscription";
const DEFAULT_APP_BASE_URL = "https://app.cline.bot";

export function buildClinePassSubscriptionPageUrl(
	appBaseUrl: string | undefined,
): string {
	const url = new URL(
		CLINE_PASS_SUBSCRIPTION_PATH,
		appBaseUrl || DEFAULT_APP_BASE_URL,
	);
	url.searchParams.set("personal", "true");
	return url.toString();
}
