import net from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClineOAuthCredentials } from "./cline";
import { getValidClineCredentials, loginClineOAuth } from "./cline";

const PROVIDER_OPTIONS = {
	apiBaseUrl: "https://auth.example.com",
};
const ORIGINAL_FETCH = globalThis.fetch;
const socketBindingSupported = await (async () => {
	try {
		const srv = net.createServer();
		await new Promise<void>((resolve, reject) => {
			srv.listen(0, "127.0.0.1", () => resolve());
			srv.once("error", reject);
		});
		await new Promise<void>((resolve, reject) =>
			srv.close((err) => (err ? reject(err) : resolve())),
		);
		return true;
	} catch {
		return false;
	}
})();
const _socketIt = socketBindingSupported ? it : it.skip;

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
		const current = createCredentials({ expires: 101_000 });
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
		});
		nowSpy.mockRestore();
	});

	it("returns null when refresh fails with invalid_grant", async () => {
		const nowSpy = vi.spyOn(Date, "now").mockReturnValue(100_000);
		const current = createCredentials({ expires: 101_000 });
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

		const result = await getValidClineCredentials(current, PROVIDER_OPTIONS);
		expect(result).toBeNull();
		nowSpy.mockRestore();
	});

	it("keeps current credentials on transient refresh error while token remains valid", async () => {
		const nowSpy = vi.spyOn(Date, "now").mockReturnValue(100_000);
		const current = createCredentials({ expires: 150_000 });
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

		const result = await getValidClineCredentials(current, PROVIDER_OPTIONS, {
			refreshBufferMs: 60_000,
			retryableTokenGraceMs: 30_000,
		});
		expect(result).toBe(current);
		nowSpy.mockRestore();
	});
});

describe("auth/cline loginClineOAuth", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		globalThis.fetch = ORIGINAL_FETCH;
	});

	it("completes WorkOS device auth and registers tokens", async () => {
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
							accessToken: "cline-access",
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
		const credentials = await loginClineOAuth({
			apiBaseUrl: "https://api.cline.bot",
			useWorkOSDeviceAuth: true,
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
			access: "cline-access",
			refresh: "cline-refresh",
			accountId: "acct-1",
			email: "user@example.com",
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
	});
});
