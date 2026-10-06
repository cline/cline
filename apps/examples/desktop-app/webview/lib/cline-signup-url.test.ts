import { describe, expect, it, vi } from "vitest";
import { getClineSignUpUrl } from "./cline-signup-url";

const { environmentConfig } = vi.hoisted(() => ({
	environmentConfig: vi.fn(),
}));
vi.mock("@cline/shared/browser", () => ({
	getClineEnvironmentConfig: environmentConfig,
}));

describe("getClineSignUpUrl", () => {
	it.each([
		["https://api.example.test", "client_example"],
		["http://localhost:7777", "client_local"],
	])("requests registration with the callback for %s", (apiBaseUrl, workOsClientId) => {
		environmentConfig.mockReturnValue({ apiBaseUrl, workOsClientId });
		const url = new URL(getClineSignUpUrl());
		expect(url.origin).toBe("https://api.workos.com");
		expect(url.pathname).toBe("/user_management/authorize");
		expect(Object.fromEntries(url.searchParams)).toEqual({
			client_id: workOsClientId,
			provider: "authkit",
			response_type: "code",
			redirect_uri: `${apiBaseUrl}/api/v1/auth/callback`,
			screen_hint: "sign-up",
		});
	});
});
