import { getClineEnvironmentConfig } from "@cline/shared/browser";

/** Start a web registration with fresh server-generated OAuth state. */
export function getClineSignUpUrl(): string {
	const config = getClineEnvironmentConfig();
	const url = new URL("/api/v1/auth/authorize", config.apiBaseUrl);
	url.searchParams.set("client_type", "web");
	url.searchParams.set(
		"callback_url",
		new URL("/dashboard", config.appBaseUrl).toString(),
	);
	url.searchParams.set("screen_hint", "sign-up");
	return url.toString();
}
