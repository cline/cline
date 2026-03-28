import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClineOAuthCredentials } from "./cline";
import { getValidClineCredentials } from "./cline";

const PROVIDER_OPTIONS = {
	apiBaseUrl: "https://auth.example.com",
};

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
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("returns existing credentials when not expired", async () => {
		const nowSpy = vi.spyOn(Date, "now").mockReturnValue(10_000);
		const current = createCredentials({ expires: 400_000 });
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

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
		vi.stubGlobal("fetch", fetchMock);

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
		vi.stubGlobal(
			"fetch",
			vi.fn(
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
			),
		);

		const result = await getValidClineCredentials(current, PROVIDER_OPTIONS);
		expect(result).toBeNull();
		nowSpy.mockRestore();
	});

	it("keeps current credentials on transient refresh error while token remains valid", async () => {
		const nowSpy = vi.spyOn(Date, "now").mockReturnValue(100_000);
		const current = createCredentials({ expires: 150_000 });
		vi.stubGlobal(
			"fetch",
			vi.fn(
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
			),
		);

		const result = await getValidClineCredentials(current, PROVIDER_OPTIONS, {
			refreshBufferMs: 60_000,
			retryableTokenGraceMs: 30_000,
		});
		expect(result).toBe(current);
		nowSpy.mockRestore();
	});
});
