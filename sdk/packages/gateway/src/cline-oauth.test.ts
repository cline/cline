import { describe, expect, it, vi } from "vitest";
import {
	type GatewayClineOAuthError,
	GatewayClineOAuthService,
} from "./cline-oauth";

function jsonResponse(value: unknown, status = 200): Response {
	return new Response(JSON.stringify(value), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

describe("GatewayClineOAuthService", () => {
	it("runs WorkOS device auth, opens the verification URL, and persists before resolving", async () => {
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				jsonResponse({
					device_code: "device-code",
					user_code: "ABCD-EFGH",
					verification_uri: "https://auth.example/device",
					verification_uri_complete:
						"https://auth.example/device?code=ABCD-EFGH",
					expires_in: 300,
					interval: 5,
				}),
			)
			.mockResolvedValueOnce(
				jsonResponse({
					access_token: "workos-access",
					refresh_token: "workos-refresh",
					token_type: "Bearer",
				}),
			)
			.mockResolvedValueOnce(
				jsonResponse({
					success: true,
					data: {
						accessToken: "cline-access",
						refreshToken: "cline-refresh",
						tokenType: "Bearer",
						expiresAt: "2030-01-01T00:00:00.000Z",
						userInfo: {
							clineUserId: "user-1",
							email: "person@example.com",
						},
					},
				}),
			);
		const service = new GatewayClineOAuthService({
			fetchImpl,
			apiBaseUrl: "https://api.example",
			workosApiBaseUrl: "https://workos.example",
			workOsClientId: "client-id",
			now: () => 1_000,
		});
		const opened: string[] = [];
		const persisted: unknown[] = [];

		const result = await service.login({
			actor: "desktop-1",
			providerId: "cline",
			openExternalUrl: async (url) => opened.push(url),
			persistCredentials: (credentials) => persisted.push(credentials),
		});

		expect(opened).toEqual(["https://auth.example/device?code=ABCD-EFGH"]);
		expect(result).toBeUndefined();
		expect(persisted[0]).toMatchObject({
			access: "cline-access",
			refresh: "cline-refresh",
			accountId: "user-1",
		});
		expect(persisted).toHaveLength(1);
		expect(fetchImpl.mock.calls.map(([url]) => new URL(url).pathname)).toEqual([
			"/user_management/authorize/device",
			"/user_management/authenticate",
			"/api/v1/auth/register",
		]);
		expect(await fetchImpl.mock.calls[0]?.[1]?.body?.toString()).toContain(
			"client_id=client-id",
		);
	});

	it("cancels before credentials can be persisted", async () => {
		const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
			jsonResponse({
				device_code: "device-code",
				user_code: "ABCD-EFGH",
				verification_uri: "https://auth.example/device",
				expires_in: 300,
				interval: 5,
			}),
		);
		const service = new GatewayClineOAuthService({
			fetchImpl,
			apiBaseUrl: "https://api.example",
			workosApiBaseUrl: "https://workos.example",
			workOsClientId: "client-id",
		});
		const persist = vi.fn();

		const login = service.login({
			actor: "desktop-1",
			providerId: "cline",
			openExternalUrl: async () => {
				expect(service.cancel("cline", "desktop-1")).toBe(true);
			},
			persistCredentials: persist,
		});

		await expect(login).rejects.toMatchObject<Partial<GatewayClineOAuthError>>({
			code: "cancelled",
		});
		expect(persist).not.toHaveBeenCalled();
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});
});
