import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClineOAuthCredentials } from "./cline";
import {
	completeClineDeviceAuth,
	getValidClineCredentials,
	loginClineOAuth,
	startClineDeviceAuth,
} from "./cline";

const PROVIDER_OPTIONS = {
	apiBaseUrl: "https://auth.example.com",
};
const ORIGINAL_FETCH = globalThis.fetch;

describe("auth/cline startClineDeviceAuth", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		globalThis.fetch = ORIGINAL_FETCH;
	});

	it("accepts a host-selected WorkOS client id", async () => {
		let requestBody = "";
		globalThis.fetch = vi.fn(async (_url, init) => {
			requestBody = String(init?.body ?? "");
			return new Response(
				JSON.stringify({
					device_code: "device-code",
					user_code: "ABCD-1234",
					verification_uri: "https://workos.test/device",
					expires_in: 300,
					interval: 5,
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		}) as unknown as typeof fetch;

		await startClineDeviceAuth({ workOsClientId: "client_mobile_staging" });

		expect(new URLSearchParams(requestBody).get("client_id")).toBe(
			"client_mobile_staging",
		);
	});

	it("derives the client id from a known api base instead of the ambient env", async () => {
		let requestBody = "";
		globalThis.fetch = vi.fn(async (_url, init) => {
			requestBody = String(init?.body ?? "");
			return new Response(JSON.stringify(DEVICE_AUTHORIZATION_RESPONSE), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}) as unknown as typeof fetch;

		// No `workOsClientId`: the old fallback read the production-by-default
		// ambient config, silently pairing a PROD client with a STAGING api base.
		await startClineDeviceAuth({ apiBaseUrl: STAGING_API_BASE_URL });

		expect(new URLSearchParams(requestBody).get("client_id")).toBe(
			STAGING_CLIENT_ID,
		);
	});

	it("rejects a production client id paired with the staging api base", async () => {
		const fetchMock = vi.fn();
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		await expect(
			startClineDeviceAuth({
				apiBaseUrl: STAGING_API_BASE_URL,
				workOsClientId: PRODUCTION_CLIENT_ID,
			}),
		).rejects.toThrow(/environment mismatch/i);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("honours a WorkOS API base override", async () => {
		let requestUrl = "";
		globalThis.fetch = vi.fn(async (url) => {
			requestUrl = String(url);
			return new Response(JSON.stringify(DEVICE_AUTHORIZATION_RESPONSE), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}) as unknown as typeof fetch;

		await startClineDeviceAuth({
			workOsClientId: "client_mobile_staging",
			workOsBaseUrl: "https://workos.test",
		});

		expect(requestUrl).toBe(
			"https://workos.test/user_management/authorize/device",
		);
	});

	it("clamps an absurd expires_in and interval from the authorization response", async () => {
		globalThis.fetch = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						...DEVICE_AUTHORIZATION_RESPONSE,
						expires_in: Number.MAX_SAFE_INTEGER,
						interval: 86_400,
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				),
		) as unknown as typeof fetch;

		const authorization = await startClineDeviceAuth({
			workOsClientId: "client_mobile_staging",
		});

		expect(authorization.expiresInSeconds).toBe(30 * 60);
		expect(authorization.pollIntervalSeconds).toBe(60);
	});
});

const STAGING_API_BASE_URL = "https://core-api.staging.int.cline.bot";
const STAGING_CLIENT_ID = "client_01K3A5415VF6QBQBG3XYCW91G6";
const PRODUCTION_API_BASE_URL = "https://api.cline.bot";
const PRODUCTION_CLIENT_ID = "client_01K3A541FN8TA3EPPHTD2325AR";

const DEVICE_AUTHORIZATION_RESPONSE = {
	device_code: "device-code",
	user_code: "ABCD-1234",
	verification_uri: "https://workos.test/device",
	expires_in: 300,
	interval: 5,
};

function workOsErrorResponse(error: string, status = 400): Response {
	return new Response(JSON.stringify({ error }), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function toBase64Url(value: string): string {
	return Buffer.from(value, "utf8").toString("base64url");
}

function createJwt(payload: Record<string, unknown>): string {
	const settings = toBase64Url(JSON.stringify({ alg: "none", typ: "JWT" }));
	const jwtPayload = toBase64Url(JSON.stringify(payload));

	return `${settings}.${jwtPayload}.sig`;
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
			metadata: { provider: "google", sessionStartedAtMs: 12_345 },
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
						headers: {
							"Content-Type": "application/json",
							"x-request-id": "req-invalid-grant",
						},
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
					reason: "token_invalid",
					status: 401,
					errorCode: "invalid_grant",
					request_id: "req-invalid-grant",
					sessionId: "sid-1",
					sessionDurationMs: Date.now() - 12_345,
				}),
			}),
		);
		nowSpy.mockRestore();
	});

	it("omits request_id when a failed response has no request ID header", async () => {
		const current = createCredentials({ expires: 0 });
		globalThis.fetch = vi.fn(
			async () =>
				new Response(JSON.stringify({ error: "invalid_grant" }), {
					status: 401,
					headers: { "Content-Type": "application/json" },
				}),
		) as unknown as typeof fetch;

		const capture = vi.fn();
		await getValidClineCredentials(current, {
			...PROVIDER_OPTIONS,
			telemetry: { capture } as never,
		});

		const logoutEvent = capture.mock.calls.find(
			([event]) => event.event === "user.auth_logged_out",
		)?.[0];
		expect(logoutEvent?.properties).not.toHaveProperty("request_id");
	});

	it("keeps current credentials on transient refresh error while token remains valid", async () => {
		const nowSpy = vi.spyOn(Date, "now").mockReturnValue(100_000);
		const current = createCredentials({
			access: createJwt({ sid: "sid-2", sub: "-2" }),
			expires: 150_000,
			accountId: undefined,
			metadata: {
				provider: "google",
				sessionStartedAtMs: 67_890,
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
						headers: {
							"Content-Type": "application/json",
							"x-request-id": "req-soft-failure-valid",
						},
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
					request_id: "req-soft-failure-valid",
					tokenExpired: false,
					sessionId: "sid-2",
					sessionDurationMs: Date.now() - 67_890,
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
						headers: {
							"Content-Type": "application/json",
							"x-request-id": "req-soft-failure-expired",
						},
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
					request_id: "req-soft-failure-expired",
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
					sessionId: "sid-login",
					sessionDurationMs: Date.now() - 200_000,
				}),
			}),
		);
		nowSpy.mockRestore();
	});

	it("includes the request ID when initial authentication fails", async () => {
		globalThis.fetch = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						error: "invalid_request",
						error_description: "device auth failed",
					}),
					{
						status: 400,
						headers: {
							"Content-Type": "application/json",
							"x-request-id": "req-device-authorization",
						},
					},
				),
		) as unknown as typeof fetch;
		const capture = vi.fn();

		await expect(
			loginClineOAuth({
				apiBaseUrl: "https://api.cline.bot",
				useWorkOSDeviceAuth: true,
				telemetry: { capture } as never,
				callbacks: {
					onAuth: vi.fn(),
					onPrompt: async () => "",
				},
			}),
		).rejects.toThrow("Device authorization failed: 400");
		expect(capture).toHaveBeenCalledWith(
			expect.objectContaining({
				event: "user.auth_failed",
				properties: expect.objectContaining({
					request_id: "req-device-authorization",
				}),
			}),
		);
	});
});

describe("auth/cline completeClineDeviceAuth", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		globalThis.fetch = ORIGINAL_FETCH;
	});

	it("includes the request ID when device polling fails", async () => {
		let requestBody = "";
		globalThis.fetch = vi.fn(async (_url, init) => {
			requestBody = String(init?.body ?? "");
			return new Response(
				JSON.stringify({
					error: "access_denied",
					error_description: "authorization denied",
				}),
				{
					status: 403,
					headers: {
						"Content-Type": "application/json",
						"x-request-id": "req-device-poll",
					},
				},
			);
		}) as unknown as typeof fetch;
		const capture = vi.fn();

		await expect(
			completeClineDeviceAuth({
				deviceCode: "device-code",
				expiresInSeconds: 300,
				pollIntervalSeconds: 1,
				apiBaseUrl: "https://api.cline.bot",
				telemetry: { capture } as never,
				workOsClientId: "client_mobile_staging",
			}),
		).rejects.toThrow("authorization denied");
		expect(new URLSearchParams(requestBody).get("client_id")).toBe(
			"client_mobile_staging",
		);
		expect(capture).toHaveBeenCalledWith(
			expect.objectContaining({
				event: "user.auth_failed",
				properties: expect.objectContaining({ request_id: "req-device-poll" }),
			}),
		);
	});

	it("rejects a staging api base combined with the production client id", async () => {
		const fetchMock = vi.fn();
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		await expect(
			completeClineDeviceAuth({
				deviceCode: "device-code",
				expiresInSeconds: 300,
				pollIntervalSeconds: 1,
				apiBaseUrl: STAGING_API_BASE_URL,
				workOsClientId: PRODUCTION_CLIENT_ID,
			}),
		).rejects.toThrow(/environment mismatch/i);
		// Never polled: no token can be minted against the wrong environment.
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("rejects a production api base combined with the staging client id", async () => {
		const fetchMock = vi.fn();
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		await expect(
			completeClineDeviceAuth({
				deviceCode: "device-code",
				expiresInSeconds: 300,
				pollIntervalSeconds: 1,
				apiBaseUrl: PRODUCTION_API_BASE_URL,
				workOsClientId: STAGING_CLIENT_ID,
			}),
		).rejects.toThrow(/environment mismatch/i);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("derives the client id from the api base when none is passed", async () => {
		let requestBody = "";
		globalThis.fetch = vi.fn(async (_url, init) => {
			requestBody = String(init?.body ?? "");
			return workOsErrorResponse("access_denied", 403);
		}) as unknown as typeof fetch;

		await expect(
			completeClineDeviceAuth({
				deviceCode: "device-code",
				expiresInSeconds: 300,
				pollIntervalSeconds: 1,
				apiBaseUrl: STAGING_API_BASE_URL,
			}),
		).rejects.toThrow();

		expect(new URLSearchParams(requestBody).get("client_id")).toBe(
			STAGING_CLIENT_ID,
		);
	});

	it("polls the WorkOS API base override", async () => {
		let requestUrl = "";
		globalThis.fetch = vi.fn(async (url) => {
			requestUrl = String(url);
			return workOsErrorResponse("access_denied", 403);
		}) as unknown as typeof fetch;

		await expect(
			completeClineDeviceAuth({
				deviceCode: "device-code",
				expiresInSeconds: 300,
				pollIntervalSeconds: 1,
				apiBaseUrl: STAGING_API_BASE_URL,
				workOsClientId: STAGING_CLIENT_ID,
				workOsBaseUrl: "https://workos.test",
			}),
		).rejects.toThrow();

		expect(requestUrl).toBe("https://workos.test/user_management/authenticate");
	});

	it("clamps an absurd expiry and poll interval handed to the poll loop", async () => {
		vi.useFakeTimers();
		try {
			const fetchMock = vi.fn(async () =>
				workOsErrorResponse("authorization_pending"),
			);
			globalThis.fetch = fetchMock as unknown as typeof fetch;

			const pending = completeClineDeviceAuth({
				deviceCode: "device-code",
				// A hostile/malformed response would have kept this loop alive for
				// ~285 millennia, one poll per day.
				expiresInSeconds: Number.MAX_SAFE_INTEGER,
				pollIntervalSeconds: 86_400,
				apiBaseUrl: STAGING_API_BASE_URL,
				workOsClientId: STAGING_CLIENT_ID,
			});
			const assertion = expect(pending).rejects.toThrow(/timed out/i);

			// Expiry clamps to 30 minutes, so the loop is done well inside 31.
			await vi.advanceTimersByTimeAsync(31 * 60 * 1000);
			await assertion;

			// Interval clamps to 60s: ~30 polls in 30 minutes, not a single one.
			expect(fetchMock.mock.calls.length).toBeGreaterThan(20);
			expect(fetchMock.mock.calls.length).toBeLessThan(40);
		} finally {
			vi.useRealTimers();
		}
	});

	it("backs off by 5 seconds on slow_down, per RFC 8628", async () => {
		vi.useFakeTimers();
		try {
			const pollTimes: number[] = [];
			let calls = 0;
			globalThis.fetch = vi.fn(async () => {
				pollTimes.push(Date.now());
				calls += 1;
				return calls === 1
					? workOsErrorResponse("slow_down")
					: workOsErrorResponse("access_denied", 403);
			}) as unknown as typeof fetch;

			const pending = completeClineDeviceAuth({
				deviceCode: "device-code",
				expiresInSeconds: 300,
				pollIntervalSeconds: 5,
				apiBaseUrl: STAGING_API_BASE_URL,
				workOsClientId: STAGING_CLIENT_ID,
			});
			const assertion = expect(pending).rejects.toThrow();
			await vi.advanceTimersByTimeAsync(60_000);
			await assertion;

			expect(pollTimes).toHaveLength(2);
			// 5s interval + the RFC's 5s increment, not the old +1s.
			expect((pollTimes[1] as number) - (pollTimes[0] as number)).toBe(10_000);
		} finally {
			vi.useRealTimers();
		}
	});
});
