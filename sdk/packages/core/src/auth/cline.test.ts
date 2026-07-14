import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClineOAuthCredentials } from "./cline";
import { getValidClineCredentials, loginClineOAuth } from "./cline";

const PROVIDER_OPTIONS = {
	apiBaseUrl: "https://auth.example.com",
};
const ORIGINAL_FETCH = globalThis.fetch;

function toBase64Url(value: string): string {
	return Buffer.from(value, "utf8").toString("base64url");
}

function createJwt(payload: Record<string, unknown>): string {
	return `${toBase64Url(JSON.stringify({ alg: "none", typ: "JWT" }))}.${toBase64Url(JSON.stringify(payload))}.sig`;
}

function createCredentials(
	overrides: Partial<ClineOAuthCredentials> = {},
): ClineOAuthCredentials {
	return {
		access: "access-old",
		refresh: "refresh-old",
		expires: 0,
		accountId: "acct-1",
		email: "user@example.com",
		metadata: { provider: "google" },
		...overrides,
	};
}

describe("auth/cline getValidClineCredentials", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		globalThis.fetch = ORIGINAL_FETCH;
	});

	it("returns existing credentials when not expired", async () => {
		const nowSpy = vi.spyOn(Date, "now").mockReturnValue(10_000);
		const current = createCredentials({ expires: 400_000 });
		const fetchMock = vi.fn();
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const result = await getValidClineCredentials(current, PROVIDER_OPTIONS);
		expect(result).toBe(current);
		expect(fetchMock).not.toHaveBeenCalled();
		nowSpy.mockRestore();
	});

	it("refreshes expired credentials", async () => {
		const nowSpy = vi.spyOn(Date, "now").mockReturnValue(100_000);
		const current = createCredentials({
			expires: 101_000,
			metadata: { provider: "google", sessionStartedAtMs: 12_345 },
		});
		const fetchMock = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						success: true,
						data: {
							accessToken: "access-new",
							refreshToken: "refresh-new",
							tokenType: "Bearer",
							expiresAt: "2030-01-01T00:00:00.000Z",
							userInfo: {
								subject: "sub-1",
								email: "new@example.com",
								name: "New User",
								clineUserId: "acct-2",
								accounts: [],
							},
						},
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				),
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const result = await getValidClineCredentials(current, PROVIDER_OPTIONS);
		expect(result).toMatchObject({
			access: "access-new",
			refresh: "refresh-new",
			accountId: "acct-2",
			email: "new@example.com",
			metadata: {
				provider: "google",
				sessionStartedAtMs: 12_345,
				tokenType: "Bearer",
			},
		});
		nowSpy.mockRestore();
	});

	it("does not add sessionStartedAtMs when refreshing credentials that do not already have it", async () => {
		const nowSpy = vi.spyOn(Date, "now").mockReturnValue(100_000);
		const current = createCredentials({
			expires: 101_000,
			metadata: { provider: "google" },
		});
		const fetchMock = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						success: true,
						data: {
							accessToken: "access-new",
							refreshToken: "refresh-new",
							tokenType: "Bearer",
							expiresAt: "2030-01-01T00:00:00.000Z",
							userInfo: {
								subject: "sub-1",
								email: "new@example.com",
								name: "New User",
								clineUserId: "acct-2",
								accounts: [],
							},
						},
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				),
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const result = await getValidClineCredentials(current, PROVIDER_OPTIONS);
		expect(result?.metadata).toMatchObject({
			provider: "google",
			tokenType: "Bearer",
		});
		expect(result?.metadata).not.toHaveProperty("sessionStartedAtMs");
		nowSpy.mockRestore();
	});

	it("returns null when refresh fails with invalid_grant", async () => {
		const nowSpy = vi.spyOn(Date, "now").mockReturnValue(100_000);
		const current = createCredentials({
			access: createJwt({ sid: "sid-1", sub: "user-1" }),
			expires: 101_000,
			accountId: "cline-user-1",
			metadata: { provider: "google", sessionStartedAt: 12_345 },
		});
		globalThis.fetch = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						error: "invalid_grant",
						error_description: "refresh expired",
					}),
					{
						status: 401,
						headers: { "Content-Type": "application/json" },
					},
				),
		) as unknown as typeof fetch;

		const capture = vi.fn();
		const result = await getValidClineCredentials(current, {
			...PROVIDER_OPTIONS,
			telemetry: { capture } as never,
		});
		expect(result).toBeNull();
		expect(capture).toHaveBeenCalledWith(
			expect.objectContaining({
				event: "user.auth_logged_out",
				properties: expect.objectContaining({
					reason: "invalid_grant",
					status: 401,
					errorCode: "invalid_grant",
					session_id: "sid-1",
					user_id: "cline-user-1",
					session_started_at: 12_345,
				}),
			}),
		);
		nowSpy.mockRestore();
	});

	it("keeps current credentials on transient refresh error while token remains valid", async () => {
		const nowSpy = vi.spyOn(Date, "now").mockReturnValue(100_000);
		const current = createCredentials({
			access: createJwt({ sid: "sid-2", sub: "user-2" }),
			expires: 150_000,
			accountId: undefined,
			metadata: {
				provider: "google",
				sessionStartedAt: 67_890,
				userInfo: {
					subject: "subject-2",
					email: "user@example.com",
					name: "User",
					clineUserId: "cline-user-2",
					accounts: [],
				},
			},
		});
		globalThis.fetch = vi.fn(
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
		) as unknown as typeof fetch;

		const capture = vi.fn();
		const result = await getValidClineCredentials(
			current,
			{ ...PROVIDER_OPTIONS, telemetry: { capture } as never },
			{
				refreshBufferMs: 60_000,
				retryableTokenGraceMs: 30_000,
			},
		);
		expect(result).toBe(current);
		expect(capture).toHaveBeenCalledWith(
			expect.objectContaining({
				event: "user.auth_refresh_soft_failure",
				properties: expect.objectContaining({
					status: 500,
					tokenExpired: false,
					session_id: "sid-2",
					user_id: "cline-user-2",
					session_started_at: 67_890,
				}),
			}),
		);
		nowSpy.mockRestore();
	});

	it("throws on transient refresh error when the token is already expired", async () => {
		// A network blip landing after expiry is NOT an invalid grant; returning
		// null here is what made clients wipe stored credentials over an outage.
		const nowSpy = vi.spyOn(Date, "now").mockReturnValue(100_000);
		const current = createCredentials({ expires: 90_000 });
		globalThis.fetch = vi.fn(
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
		) as unknown as typeof fetch;

		const capture = vi.fn();
		await expect(
			getValidClineCredentials(current, {
				...PROVIDER_OPTIONS,
				telemetry: { capture } as never,
			}),
		).rejects.toThrow("Token refresh failed: 500");
		// The "prevented logout" counter: this exact situation used to wipe
		// stored credentials.
		expect(capture).toHaveBeenCalledWith(
			expect.objectContaining({
				event: "user.auth_refresh_soft_failure",
				properties: expect.objectContaining({
					status: 500,
					tokenExpired: true,
				}),
			}),
		);
		expect(capture).not.toHaveBeenCalledWith(
			expect.objectContaining({ event: "user.auth_logged_out" }),
		);
		nowSpy.mockRestore();
	});
});

describe("auth/cline loginClineOAuth", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		globalThis.fetch = ORIGINAL_FETCH;
	});

	it("completes WorkOS device auth and registers tokens", async () => {
		const nowSpy = vi.spyOn(Date, "now").mockReturnValue(200_000);
		const loginAccessToken = createJwt({ sid: "sid-login" });
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						device_code: "dev-code-1",
						user_code: "ABCD-EFGH",
						verification_uri: "https://example.com/device",
						verification_uri_complete:
							"https://example.com/device?user_code=ABCD-EFGH",
						expires_in: 300,
						interval: 1,
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						access_token: "workos-access",
						refresh_token: "workos-refresh",
						token_type: "Bearer",
						expires_in: 3600,
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						success: true,
						data: {
							accessToken: loginAccessToken,
							refreshToken: "cline-refresh",
							tokenType: "Bearer",
							expiresAt: "2030-01-01T00:00:00.000Z",
							userInfo: {
								subject: "sub-1",
								email: "user@example.com",
								name: "User",
								clineUserId: "acct-1",
								accounts: ["acct-1"],
							},
						},
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				),
			);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const onAuth = vi.fn();
		const capture = vi.fn();
		const credentials = await loginClineOAuth({
			apiBaseUrl: "https://api.cline.bot",
			useWorkOSDeviceAuth: true,
			telemetry: {
				capture,
				setDistinctId: vi.fn(),
				updateCommonProperties: vi.fn(),
			} as never,
			callbacks: {
				onAuth,
				onPrompt: async () => "",
			},
		});

		expect(onAuth).toHaveBeenCalledTimes(1);
		expect(onAuth.mock.calls[0]?.[0]).toMatchObject({
			url: "https://example.com/device?user_code=ABCD-EFGH",
		});
		expect(credentials).toMatchObject({
			access: loginAccessToken,
			refresh: "cline-refresh",
			accountId: "acct-1",
			email: "user@example.com",
			metadata: {
				sessionStartedAtMs: 200_000,
				tokenType: "Bearer",
			},
		});
		expect(fetchMock).toHaveBeenCalledTimes(3);
		const registerCallBody = JSON.parse(
			String(fetchMock.mock.calls[2]?.[1]?.body ?? "{}"),
		);
		const deviceAuthBody = String(fetchMock.mock.calls[0]?.[1]?.body ?? "");
		const deviceAuthParams = new URLSearchParams(deviceAuthBody);
		expect(deviceAuthParams.get("client_id")).toMatch(/client_.*/);
		expect(registerCallBody).toMatchObject({
			accessToken: "workos-access",
			refreshToken: "workos-refresh",
		});
		expect(capture).toHaveBeenCalledWith(
			expect.objectContaining({
				event: "user.auth_succeeded",
				properties: expect.objectContaining({
					provider: "cline",
					session_id: "sid-login",
					session_started_at: 200_000,
				}),
			}),
		);
		nowSpy.mockRestore();
	});
});
