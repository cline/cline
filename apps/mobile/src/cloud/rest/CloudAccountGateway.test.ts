import { describe, expect, it, vi } from "vitest";
import { CloudAccountGateway } from "./CloudAccountGateway";

describe("CloudAccountGateway", () => {
	it.each([
		0, 5_000_000, 12_340_000, -1_550_000,
	])("reads personal balance %s in microcredits without treating zero as missing", async (microcredits) => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						data: { id: "user/1" },
					}),
				),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						success: true,
						data: { balance: microcredits, userId: "user/1" },
					}),
				),
			);
		const gateway = new CloudAccountGateway({
			apiBaseUrl: "https://api.test",
			getAccessToken: async () => "token",
			fetch,
		});
		await expect(gateway.creditBalance()).resolves.toBe(
			microcredits / 1_000_000,
		);
		expect(fetch.mock.calls.map(([url]) => url)).toEqual([
			"https://api.test/api/v1/users/me",
			"https://api.test/api/v1/users/user%2F1/balance",
		]);
	});
	it("reads only the selected organization, never personal credits", async () => {
		const fetch = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						data: { balance: 98_760_000, organizationId: "org/1" },
					}),
				),
		);
		const gateway = new CloudAccountGateway({
			apiBaseUrl: "https://api.test",
			getAccessToken: async () => "token",
			fetch,
		});
		await expect(gateway.creditBalance("org/1")).resolves.toBe(98.76);
		expect(fetch).toHaveBeenCalledExactlyOnceWith(
			"https://api.test/api/v1/organizations/org%2F1/balance",
			expect.anything(),
		);
	});
	it.each([
		{ data: {} },
		{ data: { balance: "100" } },
		{ success: false, data: { balance: 100 } },
		{ data: { balance: 100, organizationId: "other-org" } },
		{ data: { balance: 100, userId: "personal-user" } },
	])("rejects unreadable or unsuccessful balances instead of inventing zero", async (body) => {
		const fetch = vi.fn(async () => new Response(JSON.stringify(body)));
		const gateway = new CloudAccountGateway({
			apiBaseUrl: "https://api.test",
			getAccessToken: async () => "token",
			fetch,
		});
		await expect(gateway.creditBalance("org-1")).rejects.toThrow(
			"credit balance could not be loaded",
		);
		expect(fetch).toHaveBeenCalledOnce();
	});
	it("rejects a personal balance belonging to another user", async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ data: { id: "user-1" } })),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						data: { balance: 5_000_000, userId: "other-user" },
					}),
				),
			);
		const gateway = new CloudAccountGateway({
			apiBaseUrl: "https://api.test",
			getAccessToken: async () => "token",
			fetch,
		});
		await expect(gateway.creditBalance()).rejects.toThrow(
			"credit balance could not be loaded",
		);
	});
	it.each([
		"token",
		"workos:token",
	])("discovers organization memberships using credential %s", async (token) => {
		const fetch = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						data: {
							organizations: [
								{ organizationId: "org-1", name: "Team", active: true },
							],
						},
					}),
				),
		);
		const gateway = new CloudAccountGateway({
			apiBaseUrl: "https://api.test",
			getAccessToken: async () => token,
			fetch,
		});
		await expect(gateway.listAccounts()).resolves.toEqual([
			{ name: "Personal", active: false },
			{ organizationId: "org-1", name: "Team", active: true },
		]);
		expect(fetch).toHaveBeenCalledWith(
			"https://api.test/api/v1/users/me",
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: "Bearer workos:token",
				}),
			}),
		);
	});
	it("selects personal with null, not the previous organization ID", async () => {
		const fetch = vi.fn(async () => new Response(null, { status: 204 }));
		const gateway = new CloudAccountGateway({
			apiBaseUrl: "https://api.test",
			getAccessToken: async () => "token",
			fetch,
		});
		await gateway.switchAccount("org-1");
		await gateway.switchAccount();
		expect(fetch).toHaveBeenLastCalledWith(
			"https://api.test/api/v1/users/active-account",
			expect.objectContaining({
				method: "PUT",
				body: '{"organizationId":null}',
			}),
		);
	});
	it("rejects unauthenticated requests without calling the network", async () => {
		const fetch = vi.fn();
		const gateway = new CloudAccountGateway({
			apiBaseUrl: "https://api.test",
			getAccessToken: async () => null,
			fetch,
		});
		await expect(gateway.listAccounts()).rejects.toMatchObject({ status: 401 });
		expect(fetch).not.toHaveBeenCalled();
	});
	it("does not silently turn an unreadable account response into Personal", async () => {
		const gateway = new CloudAccountGateway({
			apiBaseUrl: "https://api.test",
			getAccessToken: async () => "token",
			fetch: vi.fn(
				async () =>
					new Response(JSON.stringify({ data: { organizations: "invalid" } })),
			),
		});
		await expect(gateway.listAccounts()).rejects.toThrow(
			"account details this app could not read",
		);
	});
});
