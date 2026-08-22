import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	CLINE_ACCOUNT_NOT_AUTHENTICATED_RESULT,
	GatewayClineAccountService,
} from "./cline-account";
import { GatewayProviderSettingsStore } from "./provider-settings";

const temporaryDirectories: string[] = [];

function temporarySettingsPath(): string {
	const directory = mkdtempSync(join(tmpdir(), "cline-gateway-account-"));
	temporaryDirectories.push(directory);
	return join(directory, "providers.json");
}

function jsonResponse(value: unknown, status = 200): Response {
	return new Response(JSON.stringify(value), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

describe("GatewayClineAccountService", () => {
	it("returns the typed signed-out result without making a network request", async () => {
		const fetchImpl = vi.fn<typeof fetch>();
		const service = new GatewayClineAccountService({
			providerSettingsPath: temporarySettingsPath(),
			fetchImpl,
		});

		expect(await service.query({ operation: "fetchMe" })).toEqual(
			CLINE_ACCOUNT_NOT_AUTHENTICATED_RESULT,
		);
		expect(await service.switchAccount({ operation: "switchAccount" })).toEqual(
			CLINE_ACCOUNT_NOT_AUTHENTICATED_RESULT,
		);
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it("maps every account-view operation and keeps the credential in server-side headers", async () => {
		const settingsPath = temporarySettingsPath();
		new GatewayProviderSettingsStore({ filePath: settingsPath }).patch(
			"cline",
			{
				enabled: true,
				settings: {
					apiKey: "server-secret",
					baseUrl: "https://api.example",
				},
			},
		);
		const organizations = [
			{
				active: true,
				memberId: "member-1",
				name: "Example Org",
				organizationId: "org-1",
				roles: ["owner"],
			},
		];
		const paths: string[] = [];
		const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
			const url = new URL(input);
			paths.push(url.pathname);
			expect(new Headers(init?.headers).get("Authorization")).toBe(
				"Bearer workos:server-secret",
			);
			switch (url.pathname) {
				case "/api/v1/users/me":
					return jsonResponse({
						id: "user-1",
						email: "person@example.com",
						displayName: "Person",
						photoUrl: "",
						createdAt: "2026-01-01",
						updatedAt: "2026-01-01",
						organizations,
					});
				case "/api/v1/users/user-1/balance":
					return jsonResponse({ balance: 10, userId: "user-1" });
				case "/api/v1/users/user-1/usages":
					return jsonResponse({ items: [{ id: "usage-1" }] });
				case "/api/v1/users/user-1/payments":
					return jsonResponse({
						paymentTransactions: [{ creatorId: "user-1", credits: 2 }],
					});
				case "/api/v1/organizations/org-1/balance":
					return jsonResponse({ balance: 20, organizationId: "org-1" });
				case "/api/v1/organizations/org-1/members/member-1/usages":
					return jsonResponse({ items: [{ id: "org-usage-1" }] });
				case "/api/v1/users/active-account":
					expect(init?.method).toBe("PUT");
					expect(JSON.parse(String(init?.body))).toEqual({
						organizationId: "org-1",
					});
					return new Response(null, { status: 204 });
				default:
					return jsonResponse({ error: "unexpected path" }, 404);
			}
		});
		const service = new GatewayClineAccountService({
			providerSettingsPath: settingsPath,
			fetchImpl,
			resolveOAuthToken: async () => undefined,
		});

		expect(await service.query({ operation: "fetchMe" })).toMatchObject({
			id: "user-1",
		});
		expect(
			await service.query({ operation: "fetchBalance", userId: "user-1" }),
		).toEqual({ balance: 10, userId: "user-1" });
		expect(
			await service.query({
				operation: "fetchUsageTransactions",
				userId: "user-1",
			}),
		).toEqual([{ id: "usage-1" }]);
		expect(
			await service.query({
				operation: "fetchPaymentTransactions",
				userId: "user-1",
			}),
		).toEqual([{ creatorId: "user-1", credits: 2 }]);
		expect(
			await service.query({ operation: "fetchUserOrganizations" }),
		).toEqual(organizations);
		expect(
			await service.query({
				operation: "fetchOrganizationBalance",
				organizationId: "org-1",
			}),
		).toEqual({ balance: 20, organizationId: "org-1" });
		expect(
			await service.query({
				operation: "fetchOrganizationUsageTransactions",
				organizationId: "org-1",
				memberId: "member-1",
			}),
		).toEqual([{ id: "org-usage-1" }]);
		expect(
			await service.switchAccount({
				operation: "switchAccount",
				organizationId: "org-1",
			}),
		).toEqual({ switched: true });
		expect(paths).toEqual([
			"/api/v1/users/me",
			"/api/v1/users/user-1/balance",
			"/api/v1/users/user-1/usages",
			"/api/v1/users/user-1/payments",
			"/api/v1/users/me",
			"/api/v1/organizations/org-1/balance",
			"/api/v1/organizations/org-1/members/member-1/usages",
			"/api/v1/users/active-account",
		]);
	});

	it("returns an actionable 401 without exposing the credential", async () => {
		const settingsPath = temporarySettingsPath();
		new GatewayProviderSettingsStore({ filePath: settingsPath }).patch(
			"cline",
			{
				settings: { apiKey: "never-show-this", baseUrl: "https://api.example" },
			},
		);
		const service = new GatewayClineAccountService({
			providerSettingsPath: settingsPath,
			resolveOAuthToken: async () => undefined,
			fetchImpl: async () => jsonResponse({}, 401),
		});

		await expect(service.query({ operation: "fetchMe" })).rejects.toThrow(
			"failed with status 401",
		);
		await expect(service.query({ operation: "fetchMe" })).rejects.not.toThrow(
			"never-show-this",
		);
	});
});
