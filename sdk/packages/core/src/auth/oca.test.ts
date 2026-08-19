import { afterEach, describe, expect, it, vi } from "vitest";
import { getValidOcaCredentials } from "./oca";
import type { OAuthCredentials } from "./types";

function toBase64Url(value: string): string {
	return Buffer.from(value, "utf8").toString("base64url");
}

function createJwt(payload: Record<string, unknown>): string {
	return `${toBase64Url(JSON.stringify({ alg: "none", typ: "JWT" }))}.${toBase64Url(JSON.stringify(payload))}.sig`;
}

function createCredentials(
	overrides: Partial<OAuthCredentials> = {},
): OAuthCredentials {
	return {
		access: "access-old",
		refresh: "refresh-old",
		expires: 0,
		accountId: "acct-old",
		email: "old@example.com",
		metadata: { provider: "oca", mode: "internal" },
		...overrides,
	};
}

describe("auth/oca getValidOcaCredentials", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("returns current credentials when token is still fresh", async () => {
		const nowSpy = vi.spyOn(Date, "now").mockReturnValue(10_000);
		const current = createCredentials({ expires: 400_000 });
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		const result = await getValidOcaCredentials(current);
		expect(result).toBe(current);
		expect(fetchMock).not.toHaveBeenCalled();
		nowSpy.mockRestore();
	});

	it("refreshes an expired token after discovery", async () => {
		const nowSpy = vi.spyOn(Date, "now").mockReturnValue(100_000);
		const idToken = createJwt({
			sub: "acct-new",
			email: "new@example.com",
			exp: 2_000_000_000,
		});

		const fetchMock = vi
			.fn()
			.mockImplementationOnce(
				async () =>
					new Response(
						JSON.stringify({
							token_endpoint: "https://idcs.example.com/oauth2/v1/token",
						}),
						{
							status: 200,
							headers: { "Content-Type": "application/json" },
						},
					),
			)
			.mockImplementationOnce(
				async () =>
					new Response(
						JSON.stringify({
							access_token: createJwt({
								sub: "acct-new",
								email: "new@example.com",
								exp: 2_000_000_000,
							}),
							refresh_token: "refresh-new",
							id_token: idToken,
						}),
						{ status: 200, headers: { "Content-Type": "application/json" } },
					),
			);

		vi.stubGlobal("fetch", fetchMock);

		const result = await getValidOcaCredentials(
			createCredentials({ expires: 101_000 }),
			undefined,
			{
				config: {
					internal: {
						clientId: "client-1",
						idcsUrl: "https://idcs.example.com",
						scopes: "openid offline_access",
						baseUrl: "https://oca.example.com",
					},
				},
			},
		);

		expect(result).toMatchObject({
			access: expect.any(String),
			refresh: "refresh-new",
			accountId: "acct-new",
			email: "new@example.com",
			metadata: {
				provider: "oca",
				mode: "internal",
			},
		});
		expect(fetchMock).toHaveBeenCalledTimes(2);
		nowSpy.mockRestore();
	});

	it("returns null when refresh fails with invalid_grant", async () => {
		const nowSpy = vi.spyOn(Date, "now").mockReturnValue(100_000);
		const fetchMock = vi
			.fn()
			.mockImplementationOnce(
				async () =>
					new Response(
						JSON.stringify({
							token_endpoint: "https://idcs.invalid/oauth2/v1/token",
						}),
						{
							status: 200,
							headers: { "Content-Type": "application/json" },
						},
					),
			)
			.mockImplementationOnce(
				async () =>
					new Response(
						JSON.stringify({
							error: "invalid_grant",
							error_description: "expired refresh token",
						}),
						{
							status: 400,
							headers: { "Content-Type": "application/json" },
						},
					),
			);
		vi.stubGlobal("fetch", fetchMock);

		const result = await getValidOcaCredentials(
			createCredentials({ expires: 101_000 }),
			undefined,
			{
				config: {
					internal: {
						clientId: "client-2",
						idcsUrl: "https://idcs.invalid",
						scopes: "openid offline_access",
						baseUrl: "https://oca.example.com",
					},
				},
			},
		);
		expect(result).toBeNull();
		nowSpy.mockRestore();
	});

	it("keeps current credentials on transient refresh failures when access token is still usable", async () => {
		const nowSpy = vi.spyOn(Date, "now").mockReturnValue(100_000);
		const fetchMock = vi
			.fn()
			.mockImplementationOnce(
				async () =>
					new Response(
						JSON.stringify({
							token_endpoint: "https://idcs.retry/oauth2/v1/token",
						}),
						{
							status: 200,
							headers: { "Content-Type": "application/json" },
						},
					),
			)
			.mockImplementationOnce(
				async () =>
					new Response(
						JSON.stringify({
							error: "server_error",
							error_description: "temporary issue",
						}),
						{
							status: 500,
							headers: { "Content-Type": "application/json" },
						},
					),
			);
		vi.stubGlobal("fetch", fetchMock);

		const current = createCredentials({ expires: 150_000 });
		const result = await getValidOcaCredentials(
			current,
			{
				refreshBufferMs: 60_000,
				retryableTokenGraceMs: 30_000,
			},
			{
				config: {
					internal: {
						clientId: "client-3",
						idcsUrl: "https://idcs.retry",
						scopes: "openid offline_access",
						baseUrl: "https://oca.example.com",
					},
				},
			},
		);
		expect(result).toBe(current);
		nowSpy.mockRestore();
	});

	it("re-discovers token endpoint shortly after discovery fallback errors", async () => {
		const nowSpy = vi.spyOn(Date, "now").mockReturnValue(100_000);
		const fetchMock = vi
			.fn()
			// first refresh: discovery fails and fallback endpoint is used
			.mockImplementationOnce(async () => new Response(null, { status: 503 }))
			.mockImplementationOnce(
				async () =>
					new Response(
						JSON.stringify({
							error: "server_error",
							error_description: "temporary issue",
						}),
						{
							status: 500,
							headers: { "Content-Type": "application/json" },
						},
					),
			)
			// second refresh within fallback TTL: discovery should still be cached
			.mockImplementationOnce(
				async () =>
					new Response(
						JSON.stringify({
							error: "server_error",
							error_description: "temporary issue",
						}),
						{
							status: 500,
							headers: { "Content-Type": "application/json" },
						},
					),
			)
			// third refresh after fallback TTL: discovery should be retried
			.mockImplementationOnce(
				async () =>
					new Response(
						JSON.stringify({
							token_endpoint: "https://idcs.fallback/oauth2/v2/token",
						}),
						{
							status: 200,
							headers: { "Content-Type": "application/json" },
						},
					),
			)
			.mockImplementationOnce(
				async () =>
					new Response(
						JSON.stringify({
							error: "server_error",
							error_description: "temporary issue",
						}),
						{
							status: 500,
							headers: { "Content-Type": "application/json" },
						},
					),
			);
		vi.stubGlobal("fetch", fetchMock);

		const current = createCredentials({ expires: 10_000_000 });
		const providerOptions = {
			config: {
				internal: {
					clientId: "client-fallback-ttl",
					idcsUrl: "https://idcs.fallback",
					scopes: "openid offline_access",
					baseUrl: "https://oca.example.com",
				},
			},
		};

		const first = await getValidOcaCredentials(
			current,
			{ forceRefresh: true },
			providerOptions,
		);
		expect(first).toBe(current);

		nowSpy.mockReturnValue(200_000);
		const second = await getValidOcaCredentials(
			current,
			{ forceRefresh: true },
			providerOptions,
		);
		expect(second).toBe(current);

		nowSpy.mockReturnValue(500_001);
		const third = await getValidOcaCredentials(
			current,
			{ forceRefresh: true },
			providerOptions,
		);
		expect(third).toBe(current);

		expect(fetchMock).toHaveBeenCalledTimes(5);
		expect(fetchMock).toHaveBeenNthCalledWith(
			1,
			"https://idcs.fallback/.well-known/openid-configuration",
			expect.objectContaining({ method: "GET" }),
		);
		expect(fetchMock).toHaveBeenNthCalledWith(
			2,
			"https://idcs.fallback/oauth2/v1/token",
			expect.objectContaining({ method: "POST" }),
		);
		expect(fetchMock).toHaveBeenNthCalledWith(
			3,
			"https://idcs.fallback/oauth2/v1/token",
			expect.objectContaining({ method: "POST" }),
		);
		expect(fetchMock).toHaveBeenNthCalledWith(
			4,
			"https://idcs.fallback/.well-known/openid-configuration",
			expect.objectContaining({ method: "GET" }),
		);
		expect(fetchMock).toHaveBeenNthCalledWith(
			5,
			"https://idcs.fallback/oauth2/v2/token",
			expect.objectContaining({ method: "POST" }),
		);
		nowSpy.mockRestore();
	});
});
