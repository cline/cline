import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../utils/types";

const coreMocks = vi.hoisted(() => {
	const serviceOptions: Array<{
		apiBaseUrl: string;
		getAuthToken: () => Promise<string | undefined | null>;
	}> = [];
	return {
		getProviderSettings: vi.fn(),
		saveProviderSettings: vi.fn(),
		getValidClineCredentials: vi.fn(),
		serviceOptions,
	};
});

vi.mock("@cline/core", () => {
	return {
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
		getValidClineCredentials: coreMocks.getValidClineCredentials,
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

describe("createClineAccountService", () => {
	beforeEach(() => {
		coreMocks.getProviderSettings.mockReset();
		coreMocks.saveProviderSettings.mockReset();
		coreMocks.getValidClineCredentials.mockReset();
		coreMocks.serviceOptions.length = 0;
	});

	it("refreshes persisted Cline OAuth credentials before creating the account service", async () => {
		coreMocks.getProviderSettings.mockReturnValue({
			provider: "cline",
			auth: {
				accessToken: "workos:old-access",
				refreshToken: "refresh-token",
				accountId: "acct-old",
				expiresAt: 1,
			},
		});
		coreMocks.getValidClineCredentials.mockResolvedValue({
			access: "new-access",
			refresh: "new-refresh",
			expires: 4_000_000_000_000,
			accountId: "acct-new",
		});

		const { createClineAccountService } = await import("./cline-account");
		const service = await createClineAccountService({ config: makeConfig() });

		expect(service).toBeDefined();
		expect(coreMocks.getValidClineCredentials).toHaveBeenCalledWith(
			{
				access: "old-access",
				refresh: "refresh-token",
				expires: 1,
				accountId: "acct-old",
			},
			{ apiBaseUrl: "https://api.cline.bot" },
		);
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
		coreMocks.getProviderSettings.mockReturnValue({
			provider: "cline",
			auth: {
				accessToken: "workos:old-access",
				refreshToken: "refresh-token",
				expiresAt: 1,
			},
		});
		coreMocks.getValidClineCredentials.mockResolvedValue(null);

		const { createClineAccountService } = await import("./cline-account");

		await expect(
			createClineAccountService({ config: makeConfig() }),
		).rejects.toThrow(
			"Cline account requires re-authentication. Run cline auth cline.",
		);
	});
});
