import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../utils/types";

const coreMocks = vi.hoisted(() => {
	const serviceOptions: Array<{
		apiBaseUrl: string;
		getAuthToken: () => Promise<string | undefined | null>;
	}> = [];
	return {
		getProviderSettings: vi.fn(),
		saveProviderSettings: vi.fn(),
		serviceOptions,
	};
});

vi.mock("@cline/core", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@cline/core")>();
	return {
		...actual,
		ClineAccountService: class {
			constructor(options: {
				apiBaseUrl: string;
				getAuthToken: () => Promise<string | undefined | null>;
			}) {
				coreMocks.serviceOptions.push(options);
			}
		},
		ProviderSettingsManager: class {
			getProviderSettings(providerId: string) {
				return coreMocks.getProviderSettings(providerId);
			}
			saveProviderSettings(settings: unknown, options?: unknown) {
				coreMocks.saveProviderSettings(settings, options);
			}
		},
	};
});

function makeConfig(overrides: Partial<Config> = {}): Config {
	return {
		providerId: "cline",
		modelId: "anthropic/claude-sonnet-4.6",
		apiKey: "",
		verbose: false,
		sandbox: false,
		thinking: false,
		outputMode: "text",
		mode: "act",
		defaultToolAutoApprove: false,
		toolPolicies: {},
		enableTools: true,
		cwd: "/tmp/workspace",
		logger: {
			debug: vi.fn(),
			log: vi.fn(),
			error: vi.fn(),
		},
		...overrides,
	} as unknown as Config;
}

function mockFetchJson(body: unknown, status = 200): void {
	vi.stubGlobal(
		"fetch",
		vi.fn(
			async () =>
				new Response(JSON.stringify(body), {
					status,
					headers: { "Content-Type": "application/json" },
				}),
		) as unknown as typeof fetch,
	);
}

describe("createClineAccountService", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		coreMocks.getProviderSettings.mockReset();
		coreMocks.saveProviderSettings.mockReset();
		coreMocks.serviceOptions.length = 0;
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it("refreshes persisted Cline OAuth credentials before creating the account service", async () => {
		vi.spyOn(Date, "now").mockReturnValue(100_000);
		mockFetchJson({
			success: true,
			data: {
				accessToken: "new-access",
				refreshToken: "new-refresh",
				tokenType: "Bearer",
				expiresAt: "2096-10-02T07:06:40.000Z",
				userInfo: {
					subject: "sub-new",
					email: "new@example.com",
					name: "New User",
					clineUserId: "acct-new",
					accounts: [],
				},
			},
		});
		coreMocks.getProviderSettings.mockReturnValue({
			provider: "cline",
			auth: {
				accessToken: "workos:old-access",
				refreshToken: "refresh-token",
				accountId: "acct-old",
				expiresAt: 1,
			},
		});

		const { createClineAccountService } = await import("./cline-account");
		const service = await createClineAccountService({ config: makeConfig() });

		expect(service).toBeDefined();
		expect(globalThis.fetch).toHaveBeenCalled();
		expect(coreMocks.saveProviderSettings).toHaveBeenCalledWith(
			expect.objectContaining({
				provider: "cline",
				auth: expect.objectContaining({
					accessToken: "workos:new-access",
					refreshToken: "new-refresh",
					accountId: "acct-new",
					expiresAt: 4_000_000_000_000,
				}),
			}),
			{ setLastUsed: false, tokenSource: "oauth" },
		);
		expect(await coreMocks.serviceOptions[0]?.getAuthToken()).toBe(
			"workos:new-access",
		);
	});

	it("asks the user to re-authenticate when Cline OAuth credentials cannot refresh", async () => {
		vi.spyOn(Date, "now").mockReturnValue(100_000);
		mockFetchJson(
			{
				error: "invalid_grant",
				error_description: "refresh expired",
			},
			401,
		);
		coreMocks.getProviderSettings.mockReturnValue({
			provider: "cline",
			auth: {
				accessToken: "workos:old-access",
				refreshToken: "refresh-token",
				expiresAt: 1,
			},
		});

		const { createClineAccountService } = await import("./cline-account");

		await expect(
			createClineAccountService({ config: makeConfig() }),
		).rejects.toThrow(
			"Cline account requires re-authentication. Run cline auth cline.",
		);
	});
});
