import { afterEach, describe, expect, it, vi } from "vitest";
import {
	buildAimlapiCheckoutReturnUrls,
	buildAimlapiReturnUrl,
	resolveAimlapiEndpoints,
} from "./config";

describe("aimlapi checkout configuration", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("uses production services by default", () => {
		for (const name of [
			"AIMLAPI_AUTH_URL",
			"AIMLAPI_APP_URL",
			"AIMLAPI_PAY_URL",
			"AIMLAPI_INFERENCE_URL",
			"AIMLAPI_VERIFICATION_BASE_URL",
		]) {
			vi.stubEnv(name, "");
		}

		expect(resolveAimlapiEndpoints()).toEqual({
			authBaseUrl: "https://auth.aimlapi.com",
			appBaseUrl: "https://app.aimlapi.com",
			payBaseUrl: "https://pay.aimlapi.com",
			inferenceBaseUrl: "https://api.aimlapi.com/v1",
			verificationBaseUrl: "https://app.aimlapi.com",
		});
	});

	it("falls back to the production app when no frontend URL is provided", () => {
		vi.stubEnv("AIMLAPI_RETURN_URL", "");
		expect(buildAimlapiReturnUrl("")).toBe("https://app.aimlapi.com");
		expect(buildAimlapiReturnUrl("https://example.test/app///")).toBe(
			"https://example.test/app",
		);
	});

	it("builds encoded partner-checkout return URLs", () => {
		expect(
			buildAimlapiCheckoutReturnUrls(
				"https://pay.example.test/",
				"session/token",
			),
		).toEqual({
			successUrl:
				"https://pay.example.test/checkout?checkout=success&partnerCheckout=1&sessionToken=session%2Ftoken",
			cancelUrl:
				"https://pay.example.test/checkout?checkout=cancel&partnerCheckout=1&sessionToken=session%2Ftoken",
		});
	});
});
