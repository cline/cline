import { getClineEnvironmentConfig } from "@cline/shared/browser";

/** AuthKit creates a fresh signup session and uses the API's default web callback flow. */
export function getClineSignUpUrl(): string {
	const config = getClineEnvironmentConfig();
	const url = new URL("https://api.workos.com/user_management/authorize");
	url.searchParams.set("client_id", config.workOsClientId);
	url.searchParams.set("provider", "authkit");
	url.searchParams.set("response_type", "code");
	url.searchParams.set(
		"redirect_uri",
		new URL("/api/v1/auth/callback", config.apiBaseUrl).toString(),
	);
	url.searchParams.set("screen_hint", "sign-up");
	return url.toString();
}
