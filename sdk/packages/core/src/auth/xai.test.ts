import { afterEach, describe, expect, it, vi } from "vitest";
import type { OAuthCredentials } from "./types";
import {
	getValidXaiCredentials,
	loginXaiOAuth,
	refreshXaiToken,
	XAI_OAUTH_CONFIG,
} from "./xai";

const ORIGINAL_FETCH = globalThis.fetch;
const DEVICE_AUTHORIZATION_ENDPOINT = "https://auth.example/device";
const TOKEN_ENDPOINT = "https://auth.example/token";

function jsonResponse(payload: unknown, status = 200): Response {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function createCredentials(
	overrides: Partial<OAuthCredentials> = {},
): OAuthCredentials {
	return {
		access: "access-old",
		refresh: "refresh-old",
		expires: 0,
		accountId: "account-1",
		...overrides,
	};
}

function unsignedJwt(payload: Record<string, unknown>): string {
	return `header.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.signature`;
}

describe("auth/xai", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		globalThis.fetch = ORIGINAL_FETCH;
	});

	it("completes device authorization with the public Grok client and Cline referrer", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				jsonResponse({
					device_code: "device-code",
					user_code: "ABCD-EFGH",
					verification_uri: "https://auth.example/verify",
					verification_uri_complete:
						"https://auth.example/verify?user_code=ABCD-EFGH",
					expires_in: 300,
					interval: 5,
				}),
			)
			.mockResolvedValueOnce(
				jsonResponse({
					access_token: "access-new",
					refresh_token: "refresh-new",
					expires_in: 3600,
					token_type: "Bearer",
				}),
			);
		globalThis.fetch = fetchMock as unknown as typeof fetch;
		const onAuth = vi.fn();

		const credentials = await loginXaiOAuth({
			callbacks: {
				onAuth,
				onPrompt: vi.fn(async () => ""),
			},
			deviceAuthorizationEndpoint: DEVICE_AUTHORIZATION_ENDPOINT,
			tokenEndpoint: TOKEN_ENDPOINT,
			now: () => 1_000_000,
		});

		expect(credentials).toMatchObject({
			access: "access-new",
			refresh: "refresh-new",
			expires: 4_600_000,
		});
		expect(onAuth).toHaveBeenCalledWith({
			url: "https://auth.example/verify?user_code=ABCD-EFGH",
			instructions:
				"Open https://auth.example/verify and enter code: ABCD-EFGH",
		});

		const deviceRequest = fetchMock.mock.calls[0];
		expect(deviceRequest?.[0]).toBe(DEVICE_AUTHORIZATION_ENDPOINT);
		const deviceParams = new URLSearchParams(
			String(deviceRequest?.[1]?.body ?? ""),
		);
		expect(deviceParams.get("client_id")).toBe(XAI_OAUTH_CONFIG.clientId);
		expect(deviceParams.get("scope")).toBe(XAI_OAUTH_CONFIG.scopes);
		expect(deviceParams.get("referrer")).toBe("cline");

		const tokenParams = new URLSearchParams(
			String(fetchMock.mock.calls[1]?.[1]?.body ?? ""),
		);
		expect(tokenParams.get("grant_type")).toBe(
			XAI_OAUTH_CONFIG.deviceGrantType,
		);
		expect(tokenParams.get("device_code")).toBe("device-code");
	});

	it("backs off for pending and slow-down device responses", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				jsonResponse({
					device_code: "device-code",
					user_code: "ABCD-EFGH",
					verification_uri: "https://auth.example/verify",
					expires_in: 60,
					interval: 2,
				}),
			)
			.mockResolvedValueOnce(
				jsonResponse({ error: "authorization_pending" }, 400),
			)
			.mockResolvedValueOnce(jsonResponse({ error: "slow_down" }, 400))
			.mockResolvedValueOnce(
				jsonResponse({
					access_token: "access-new",
					refresh_token: "refresh-new",
					expires_in: 3600,
				}),
			);
		globalThis.fetch = fetchMock as unknown as typeof fetch;
		const sleep = vi.fn(async () => {});
		const onProgress = vi.fn();

		await loginXaiOAuth({
			callbacks: {
				onAuth: vi.fn(),
				onPrompt: vi.fn(async () => ""),
				onProgress,
			},
			deviceAuthorizationEndpoint: DEVICE_AUTHORIZATION_ENDPOINT,
			tokenEndpoint: TOKEN_ENDPOINT,
			now: () => 0,
			sleep,
		});

		expect(sleep).toHaveBeenNthCalledWith(1, 5_000);
		expect(sleep).toHaveBeenNthCalledWith(2, 10_000);
		expect(onProgress).toHaveBeenCalledTimes(2);
	});

	it("surfaces device authorization denial", async () => {
		globalThis.fetch = vi
			.fn()
			.mockResolvedValueOnce(
				jsonResponse({
					device_code: "device-code",
					user_code: "ABCD-EFGH",
					verification_uri: "https://auth.example/verify",
				}),
			)
			.mockResolvedValueOnce(
				jsonResponse({ error: "access_denied" }, 400),
			) as unknown as typeof fetch;

		await expect(
			loginXaiOAuth({
				callbacks: {
					onAuth: vi.fn(),
					onPrompt: vi.fn(async () => ""),
				},
				deviceAuthorizationEndpoint: DEVICE_AUTHORIZATION_ENDPOINT,
				tokenEndpoint: TOKEN_ENDPOINT,
			}),
		).rejects.toThrow("xAI device authorization was denied");
	});

	it("stores a rotated refresh token", async () => {
		const fetchMock = vi.fn(
			async (
				_input: Parameters<typeof fetch>[0],
				_init?: Parameters<typeof fetch>[1],
			) =>
				jsonResponse({
					access_token: "access-new",
					refresh_token: "refresh-rotated",
					expires_in: 120,
				}),
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const credentials = await refreshXaiToken(createCredentials(), {
			tokenEndpoint: TOKEN_ENDPOINT,
			now: () => 1_000,
		});

		expect(credentials).toMatchObject({
			access: "access-new",
			refresh: "refresh-rotated",
			expires: 121_000,
		});
		const refreshParams = new URLSearchParams(
			String(fetchMock.mock.calls[0]?.[1]?.body ?? ""),
		);
		expect(refreshParams.get("grant_type")).toBe("refresh_token");
		expect(refreshParams.get("refresh_token")).toBe("refresh-old");
		expect(refreshParams.get("client_id")).toBe(XAI_OAUTH_CONFIG.clientId);
	});

	it("uses the earlier access-token JWT expiry", async () => {
		globalThis.fetch = vi.fn(async () =>
			jsonResponse({
				access_token: unsignedJwt({ exp: 5 }),
				refresh_token: "refresh-new",
				expires_in: 3600,
			}),
		) as unknown as typeof fetch;

		const credentials = await refreshXaiToken(createCredentials(), {
			tokenEndpoint: TOKEN_ENDPOINT,
			now: () => 1_000,
		});

		expect(credentials.expires).toBe(5_000);
	});

	it("keeps the prior refresh token when xAI does not rotate it", async () => {
		globalThis.fetch = vi.fn(async () =>
			jsonResponse({ access_token: "access-new", expires_in: 120 }),
		) as unknown as typeof fetch;

		const credentials = await refreshXaiToken(createCredentials(), {
			tokenEndpoint: TOKEN_ENDPOINT,
			now: () => 1_000,
		});

		expect(credentials.refresh).toBe("refresh-old");
	});

	it("returns null when refresh is rejected", async () => {
		globalThis.fetch = vi.fn(async () =>
			jsonResponse(
				{
					error: "invalid_grant",
					error_description: "refresh token expired",
				},
				400,
			),
		) as unknown as typeof fetch;
		const capture = vi.fn();

		const result = await getValidXaiCredentials(createCredentials(), {
			forceRefresh: true,
			tokenEndpoint: TOKEN_ENDPOINT,
			telemetry: { capture } as never,
		});

		expect(result).toBeNull();
		expect(capture).toHaveBeenCalledWith(
			expect.objectContaining({
				event: "user.auth_logged_out",
				properties: expect.objectContaining({
					provider: "xai-subscription",
					reason: "invalid_grant",
					errorCode: "invalid_grant",
				}),
			}),
		);
	});

	it("keeps a still-valid token after a transient refresh failure", async () => {
		globalThis.fetch = vi.fn(async () =>
			jsonResponse(
				{ error: "server_error", error_description: "try again" },
				500,
			),
		) as unknown as typeof fetch;
		const current = createCredentials({ expires: 150_000 });

		const result = await getValidXaiCredentials(current, {
			now: () => 100_000,
			refreshBufferMs: 60_000,
			retryableTokenGraceMs: 30_000,
			tokenEndpoint: TOKEN_ENDPOINT,
		});

		expect(result).toBe(current);
	});

	it("rethrows transient refresh failures after the token expires", async () => {
		globalThis.fetch = vi.fn(async () =>
			jsonResponse(
				{ error: "server_error", error_description: "try again" },
				500,
			),
		) as unknown as typeof fetch;

		await expect(
			getValidXaiCredentials(createCredentials({ expires: 90_000 }), {
				now: () => 100_000,
				forceRefresh: true,
				tokenEndpoint: TOKEN_ENDPOINT,
			}),
		).rejects.toThrow("xAI token refresh failed: 500");
	});

	it("does not retry a known-rejected bearer after forced refresh fails", async () => {
		globalThis.fetch = vi.fn(async () =>
			jsonResponse(
				{ error: "server_error", error_description: "try again" },
				500,
			),
		) as unknown as typeof fetch;

		await expect(
			getValidXaiCredentials(createCredentials({ expires: 1_000_000 }), {
				now: () => 100_000,
				forceRefresh: true,
				tokenEndpoint: TOKEN_ENDPOINT,
			}),
		).rejects.toThrow("xAI token refresh failed: 500");
	});
});
