import { describe, expect, it, vi } from "vitest";
import { ClineAccountService } from "./cline-account-service";

describe("ClineAccountService", () => {
	it("fetches current user balance and sends auth header", async () => {
		const fetchImpl = vi.fn(async (input: unknown, init?: RequestInit) => {
			expect(String(input)).toBe(
				"https://api.cline.bot/api/v1/users/user-1/balance",
			);
			expect(init?.headers).toMatchObject({
				Authorization: "Bearer workos:token-123",
			});
			return new Response(
				JSON.stringify({
					success: true,
					data: { balance: 5, userId: "user-1" },
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		});

		const service = new ClineAccountService({
			apiBaseUrl: "https://api.cline.bot",
			getAuthToken: async () => "workos:token-123",
			getCurrentUserId: () => "user-1",
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});

		const balance = await service.fetchBalance();
		expect(balance).toEqual({ balance: 5, userId: "user-1" });
	});

	it("resolves organization member id from /users/me when not provided", async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						success: true,
						data: {
							id: "u-1",
							email: "u@example.com",
							displayName: "User",
							photoUrl: "",
							createdAt: "2025-01-01T00:00:00Z",
							updatedAt: "2025-01-01T00:00:00Z",
							organizations: [
								{
									active: true,
									memberId: "member-9",
									name: "Org",
									organizationId: "org-1",
									roles: ["member"],
								},
							],
						},
					}),
					{ status: 200 },
				),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({ success: true, data: { items: [{ id: "tx-1" }] } }),
					{ status: 200 },
				),
			);

		const service = new ClineAccountService({
			apiBaseUrl: "https://api.cline.bot",
			getAuthToken: async () => "workos:token-123",
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});

		const transactions = await service.fetchOrganizationUsageTransactions({
			organizationId: "org-1",
		});

		expect(fetchImpl).toHaveBeenCalledTimes(2);
		expect(String(fetchImpl.mock.calls[1][0])).toBe(
			"https://api.cline.bot/api/v1/organizations/org-1/members/member-9/usages",
		);
		expect(transactions).toEqual([{ id: "tx-1" }]);
	});

	it("fetches remote config with organizations list", async () => {
		const remoteConfigPayload = {
			organizationId: "org-1",
			value: '{"model":"claude-4"}',
			enabled: true,
			organizations: [
				{ organizationId: "org-1", name: "Acme Corp" },
				{ organizationId: "org-2", name: "Beta Inc" },
			],
		};

		const fetchImpl = vi.fn(async (input: unknown) => {
			expect(String(input)).toBe(
				"https://api.cline.bot/api/v1/users/me/remote-config",
			);
			return new Response(
				JSON.stringify({ success: true, data: remoteConfigPayload }),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		});

		const service = new ClineAccountService({
			apiBaseUrl: "https://api.cline.bot",
			getAuthToken: async () => "workos:token-123",
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});

		const config = await service.fetchRemoteConfig();
		expect(config).toEqual(remoteConfigPayload);
		expect(config?.organizations).toHaveLength(2);
		expect(config?.organizations?.[0]).toEqual({
			organizationId: "org-1",
			name: "Acme Corp",
		});
	});

	it("fetches remote config with fallback org selected", async () => {
		const remoteConfigPayload = {
			organizationId: "org-fallback",
			value: '{"model":"claude-4"}',
			enabled: true,
			organizations: [{ organizationId: "org-fallback", name: "Fallback Org" }],
		};

		const fetchImpl = vi.fn(async () => {
			return new Response(
				JSON.stringify({ success: true, data: remoteConfigPayload }),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		});

		const service = new ClineAccountService({
			apiBaseUrl: "https://api.cline.bot",
			getAuthToken: async () => "workos:token-123",
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});

		const config = await service.fetchRemoteConfig();
		expect(config?.organizationId).toBe("org-fallback");
		expect(config?.organizations).toHaveLength(1);
		expect(config?.organizations?.[0]).toEqual({
			organizationId: "org-fallback",
			name: "Fallback Org",
		});
	});

	it("returns null when no org has remote config (data: null)", async () => {
		const fetchImpl = vi.fn(async () => {
			return new Response(JSON.stringify({ success: true, data: null }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		});

		const service = new ClineAccountService({
			apiBaseUrl: "https://api.cline.bot",
			getAuthToken: async () => "workos:token-123",
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});

		const config = await service.fetchRemoteConfig();
		expect(config).toBeNull();
	});

	it("surfaces plain text request failures without JSON parse errors", async () => {
		const fetchImpl = vi.fn(async () => {
			return new Response("Authentication failed", { status: 401 });
		});

		const service = new ClineAccountService({
			apiBaseUrl: "https://api.cline.bot",
			getAuthToken: async () => "workos:token-123",
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});

		await expect(service.fetchMe()).rejects.toThrow(
			"Cline account request failed with status 401: Authentication failed",
		);
	});

	it("surfaces invalid success payloads without JSON parse internals", async () => {
		const fetchImpl = vi.fn(async () => {
			return new Response("Account service unavailable", { status: 200 });
		});

		const service = new ClineAccountService({
			apiBaseUrl: "https://api.cline.bot",
			getAuthToken: async () => "workos:token-123",
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});

		await expect(service.fetchMe()).rejects.toThrow(
			"Cline account response was not valid JSON",
		);
	});

	it("switchAccount sends null org id for personal account", async () => {
		const fetchImpl = vi.fn(async (_input: unknown, init?: RequestInit) => {
			expect(init?.method).toBe("PUT");
			expect(init?.body).toBe(JSON.stringify({ organizationId: null }));
			return new Response(null, { status: 204 });
		});

		const service = new ClineAccountService({
			apiBaseUrl: "https://api.cline.bot",
			getAuthToken: async () => "workos:token-123",
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});

		await service.switchAccount(undefined);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});
});
