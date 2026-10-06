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
		["https://api.example.test", "https://app.example.test"],
		["http://localhost:7777", "http://localhost:3000"],
	])("requests registration from %s with a matching web callback", (apiBaseUrl, appBaseUrl) => {
		environmentConfig.mockReturnValue({ apiBaseUrl, appBaseUrl });
		const url = new URL(getClineSignUpUrl());
		expect(url.origin).toBe(apiBaseUrl);
		expect(url.pathname).toBe("/api/v1/auth/authorize");
		expect(Object.fromEntries(url.searchParams)).toEqual({
			client_type: "web",
			callback_url: `${appBaseUrl}/dashboard`,
			screen_hint: "sign-up",
		});
	});
});
