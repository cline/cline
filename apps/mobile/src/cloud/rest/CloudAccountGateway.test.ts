import { describe, expect, it, vi } from "vitest";
import { CloudAccountGateway } from "./CloudAccountGateway";

describe("CloudAccountGateway", () => {
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
