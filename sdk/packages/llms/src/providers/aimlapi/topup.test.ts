import { afterEach, describe, expect, it, vi } from "vitest";
import {
	AIMLAPI_DEFAULT_PARTNER_ID,
	AIMLAPI_DEFAULT_PARTNER_NAME,
} from "./config";
import { provisionAimlapiKey, provisionAimlapiKeyByKey } from "./topup";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
	vi.unstubAllEnvs();
});

function jsonResponse(value: unknown): Response {
	return new Response(JSON.stringify(value), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}

describe("provisionAimlapiKey", () => {
	it("carries the partner identity and session token through checkout", async () => {
		for (const name of [
			"AIMLAPI_APP_URL",
			"AIMLAPI_PAY_URL",
			"AIMLAPI_PARTNER_ID",
			"AIMLAPI_PARTNER_NAME",
		]) {
			vi.stubEnv(name, "");
		}

		const requests: Array<{ url: string; body?: Record<string, unknown> }> = [];
		globalThis.fetch = vi.fn(
			async (input: string | URL | Request, init?: RequestInit) => {
				const url = String(input);
				const body =
					typeof init?.body === "string"
						? (JSON.parse(init.body) as Record<string, unknown>)
						: undefined;
				requests.push({ url, body });

				if (url.endsWith("/v3/partner-checkout/sessions")) {
					return jsonResponse({
						id: "checkout",
						sessionToken: "session/token",
						partnerId: AIMLAPI_DEFAULT_PARTNER_ID,
						partnerName: AIMLAPI_DEFAULT_PARTNER_NAME,
						status: "pending_auth",
					});
				}
				if (url.endsWith("/pay")) {
					return jsonResponse({
						checkout: {
							providerSessionId: "provider",
							payUrl: "https://checkout.example.test",
						},
						partnerCheckout: { sessionToken: "session/token" },
					});
				}
				if (url.endsWith("/exchange")) {
					return jsonResponse({ apiKey: "key_test", apiKeyId: "key-id" });
				}
				return jsonResponse({
					sessionToken: "session/token",
					status: "paid",
				});
			},
		) as typeof fetch;

		const openCheckout = vi.fn();
		await provisionAimlapiKey({
			sessionToken: "bearer",
			exchange: true,
			amountUsd: "25",
			openCheckout,
		});

		expect(requests[0]?.body).toMatchObject({
			partnerId: AIMLAPI_DEFAULT_PARTNER_ID,
			partnerName: AIMLAPI_DEFAULT_PARTNER_NAME,
		});
		expect(requests[1]?.body).toMatchObject({
			amountUsdMinor: 2_500,
			successUrl:
				"https://pay.aimlapi.com/checkout?checkout=success&partnerCheckout=1&sessionToken=session%2Ftoken",
			cancelUrl:
				"https://pay.aimlapi.com/checkout?checkout=cancel&partnerCheckout=1&sessionToken=session%2Ftoken",
		});
		expect(openCheckout).toHaveBeenCalledWith("https://checkout.example.test");
	});
});

describe("provisionAimlapiKeyByKey", () => {
	it("funds the account via the by-key billing endpoint and keeps the key", async () => {
		for (const name of [
			"AIMLAPI_APP_URL",
			"AIMLAPI_PAY_URL",
			"AIMLAPI_INFERENCE_URL",
			"AIMLAPI_PARTNER_ID",
			"AIMLAPI_PARTNER_NAME",
		]) {
			vi.stubEnv(name, "");
		}

		const requests: Array<{ url: string; body?: Record<string, unknown> }> = [];
		globalThis.fetch = vi.fn(
			async (input: string | URL | Request, init?: RequestInit) => {
				const url = String(input);
				const body =
					typeof init?.body === "string"
						? (JSON.parse(init.body) as Record<string, unknown>)
						: undefined;
				requests.push({ url, body });

				if (url.endsWith("/v3/partner-checkout/sessions")) {
					return jsonResponse({
						id: "checkout",
						sessionToken: "session/token",
						partnerId: AIMLAPI_DEFAULT_PARTNER_ID,
						partnerName: AIMLAPI_DEFAULT_PARTNER_NAME,
						status: "pending_auth",
					});
				}
				if (url.endsWith("/v2/billing/topup")) {
					return jsonResponse({
						checkout: {
							providerSessionId: "provider",
							payUrl: "https://checkout.example.test",
						},
					});
				}
				return jsonResponse({
					sessionToken: "session/token",
					status: "paid",
				});
			},
		) as typeof fetch;

		const openCheckout = vi.fn();
		const result = await provisionAimlapiKeyByKey({
			apiKey: "key_existing",
			amountUsd: "25",
			autoTopUp: true,
			openCheckout,
		});

		const topup = requests.find((request) =>
			request.url.endsWith("/v2/billing/topup"),
		);
		expect(topup?.url).toBe("https://api.aimlapi.com/v2/billing/topup");
		expect(topup?.body).toMatchObject({
			sessionToken: "session/token",
			amountUsdMinor: 2_500,
			autoTopUp: true,
		});
		expect(topup?.body?.paymentSessionId).toEqual(expect.any(String));
		expect(openCheckout).toHaveBeenCalledWith("https://checkout.example.test");
		// The existing key is returned unchanged; only the balance grows.
		expect(result.apiKey).toBe("key_existing");
	});
});
