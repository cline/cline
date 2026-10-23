import { afterEach, describe, expect, it, vi } from "vitest";
import { AimlapiClient } from "./client";
import type { AimlapiEndpoints } from "./config";

const originalFetch = globalThis.fetch;
const endpoints: AimlapiEndpoints = {
	authBaseUrl: "https://auth.example.test",
	appBaseUrl: "https://app.example.test",
	inferenceBaseUrl: "https://api.example.test/v1",
	payBaseUrl: "https://pay.example.test",
	verificationBaseUrl: "https://front.example.test",
};

afterEach(() => {
	globalThis.fetch = originalFetch;
});

function jsonResponse(value: unknown): Response {
	return new Response(JSON.stringify(value), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}

describe("AimlapiClient", () => {
	it("creates a co-branded Cline partner-checkout session", async () => {
		let requestBody: unknown;
		globalThis.fetch = vi.fn(
			async (_input: string | URL | Request, init?: RequestInit) => {
				requestBody =
					typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
				return jsonResponse({
					id: "checkout",
					sessionToken: "session",
					partnerId: "part_HSyUEqWOLXYAn56CBHNOMBlj",
					partnerName: "Cline",
					status: "pending_auth",
				});
			},
		) as typeof fetch;

		const client = new AimlapiClient(endpoints);
		await client.createSession({
			partnerId: "part_HSyUEqWOLXYAn56CBHNOMBlj",
			partnerName: "Cline",
			returnUrl: "https://app.aimlapi.com",
		});

		expect(requestBody).toEqual({
			partnerId: "part_HSyUEqWOLXYAn56CBHNOMBlj",
			partnerName: "Cline",
			returnUrl: "https://app.aimlapi.com",
		});
	});

	it("uses the passwordless onboarding backend contracts", async () => {
		const calls: Array<{ method?: string; url: string; body?: unknown }> = [];
		globalThis.fetch = vi.fn(
			async (input: string | URL | Request, init?: RequestInit) => {
				const url = String(input);
				calls.push({
					method: init?.method,
					url,
					body:
						typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
				});
				if (url.endsWith("/v1/auth/account")) {
					return jsonResponse({ action: "sign-in" });
				}
				if (url.endsWith("/code/verify")) {
					return jsonResponse({ token: "bearer", exp: 1 });
				}
				if (url.endsWith("/passwordless")) {
					return jsonResponse({ token: "new-bearer", exp: 2 });
				}
				if (url.endsWith("/v1/keys")) {
					return jsonResponse({ key: "key_test", id: "id_test" });
				}
				if (url.endsWith("/billing/balance")) {
					return jsonResponse({
						balance: 10,
						lowBalance: true,
						lowBalanceThreshold: 20,
					});
				}
				return new Response(null, { status: 204 });
			},
		) as typeof fetch;

		const client = new AimlapiClient(endpoints);
		expect(await client.checkAccount("user@example.com")).toEqual({
			action: "sign-in",
		});
		await client.sendSignInCode("user@example.com");
		expect(await client.verifySignInCode("user@example.com", "123456")).toEqual(
			{
				token: "bearer",
				exp: 1,
			},
		);
		expect(await client.createPasswordlessAccount("new@example.com")).toEqual({
			token: "new-bearer",
			exp: 2,
		});
		expect(await client.createKey("bearer", "Cline")).toEqual({
			key: "key_test",
			id: "id_test",
		});
		expect((await client.getBalance("key_test")).lowBalance).toBe(true);

		expect(calls.map(({ method, url, body }) => [method, url, body])).toEqual([
			[
				"PATCH",
				"https://auth.example.test/v1/auth/account",
				{ email: "user@example.com" },
			],
			[
				"POST",
				"https://auth.example.test/v1/auth/sign-in/code",
				{ email: "user@example.com" },
			],
			[
				"POST",
				"https://auth.example.test/v1/auth/sign-in/code/verify",
				{ email: "user@example.com", code: "123456" },
			],
			[
				"POST",
				"https://auth.example.test/v1/auth/account/passwordless",
				{ email: "new@example.com" },
			],
			["POST", "https://app.example.test/v1/keys", { name: "Cline" }],
			["GET", "https://api.example.test/v1/billing/balance", undefined],
		]);
	});

	it("only sends autoTopUp when enabled", async () => {
		const bodies: unknown[] = [];
		globalThis.fetch = vi.fn(
			async (_input: string | URL | Request, init?: RequestInit) => {
				bodies.push(
					typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
				);
				return jsonResponse({
					checkout: {
						providerSessionId: "provider",
						payUrl: "https://checkout.test",
					},
					partnerCheckout: { sessionToken: "session" },
				});
			},
		) as typeof fetch;

		const client = new AimlapiClient(endpoints);
		await client.pay("bearer", "session", { amountUsdMinor: 2_500 });
		await client.pay("bearer", "session", {
			amountUsdMinor: 2_500,
			autoTopUp: true,
		});
		expect(bodies).toEqual([
			{ amountUsdMinor: 2_500, method: "card" },
			{ amountUsdMinor: 2_500, method: "card", autoTopUp: true },
		]);
	});
});
