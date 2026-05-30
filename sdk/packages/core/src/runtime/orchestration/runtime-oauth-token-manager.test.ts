import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	OAuthReauthRequiredError,
	RuntimeOAuthTokenManager,
} from "./runtime-oauth-token-manager";

const {
	getValidOpenAICodexCredentials,
	getValidClineCredentials,
	getValidOcaCredentials,
	isOpenAICodexTokenExpired,
} = vi.hoisted(() => ({
	getValidOpenAICodexCredentials: vi.fn(),
	getValidClineCredentials: vi.fn(),
	getValidOcaCredentials: vi.fn(),
	isOpenAICodexTokenExpired: vi.fn().mockReturnValue(true),
}));

vi.mock("../../auth/codex", () => ({
	getValidOpenAICodexCredentials,
	isOpenAICodexTokenExpired,
}));

vi.mock("../../auth/cline", () => ({
	getValidClineCredentials,
}));

vi.mock("../../auth/oca", () => ({
	getValidOcaCredentials,
}));

describe("RuntimeOAuthTokenManager", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		isOpenAICodexTokenExpired.mockReturnValue(true);
	});

	it("refreshes and persists OpenAI Codex OAuth credentials", async () => {
		const getProviderSettings = vi.fn().mockReturnValue({
			provider: "openai-codex",
			auth: {
				accessToken: "access-old",
				refreshToken: "refresh-old",
				expiresAt: Date.now() - 1_000,
				accountId: "acct-old",
			},
		});
		const saveProviderSettings = vi.fn();

		getValidOpenAICodexCredentials.mockResolvedValueOnce({
			access: "access-new",
			refresh: "refresh-new",
			expires: 4_000_000_000_000,
			accountId: "acct-new",
		});

		const manager = new RuntimeOAuthTokenManager({
			providerSettingsManager: {
				getProviderSettings,
				saveProviderSettings,
				withProviderRefreshLock: vi.fn(
					async (_providerId: string, callback: () => Promise<unknown>) =>
						callback(),
				),
			} as never,
		});

		const result = await manager.resolveProviderApiKey({
			providerId: "openai-codex",
		});

		expect(result).toMatchObject({
			providerId: "openai-codex",
			apiKey: "access-new",
			accountId: "acct-new",
			refreshed: true,
		});
		expect(saveProviderSettings).toHaveBeenCalledWith(
			expect.objectContaining({
				auth: expect.objectContaining({
					accessToken: "access-new",
					refreshToken: "refresh-new",
					accountId: "acct-new",
					expiresAt: 4_000_000_000_000,
				}),
			}),
			{ setLastUsed: false, tokenSource: "oauth" },
		);
	});

	it("throws re-auth required when refresh returns null", async () => {
		getValidOpenAICodexCredentials.mockResolvedValueOnce(null);
		const manager = new RuntimeOAuthTokenManager({
			providerSettingsManager: {
				getProviderSettings: vi.fn().mockReturnValue({
					provider: "openai-codex",
					auth: {
						accessToken: "access-old",
						refreshToken: "refresh-old",
						expiresAt: Date.now() - 1_000,
					},
				}),
				saveProviderSettings: vi.fn(),
				withProviderRefreshLock: vi.fn(
					async (_providerId: string, callback: () => Promise<unknown>) =>
						callback(),
				),
			} as never,
		});

		await expect(
			manager.resolveProviderApiKey({ providerId: "openai-codex" }),
		).rejects.toBeInstanceOf(OAuthReauthRequiredError);
	});

	it("de-duplicates concurrent refresh calls per provider", async () => {
		const refreshBarrier = Promise.resolve().then(() => ({
			access: "access-new",
			refresh: "refresh-new",
			expires: Date.now() + 60_000,
		}));
		getValidOpenAICodexCredentials.mockImplementationOnce(
			async () => refreshBarrier,
		);

		const manager = new RuntimeOAuthTokenManager({
			providerSettingsManager: {
				getProviderSettings: vi.fn().mockReturnValue({
					provider: "openai-codex",
					auth: {
						accessToken: "access-old",
						refreshToken: "refresh-old",
						expiresAt: Date.now() - 1_000,
					},
				}),
				saveProviderSettings: vi.fn(),
				withProviderRefreshLock: vi.fn(
					async (_providerId: string, callback: () => Promise<unknown>) =>
						callback(),
				),
			} as never,
		});

		const [first, second] = await Promise.all([
			manager.resolveProviderApiKey({ providerId: "openai-codex" }),
			manager.resolveProviderApiKey({ providerId: "openai-codex" }),
		]);

		expect(first?.apiKey).toBe("access-new");
		expect(second?.apiKey).toBe("access-new");
		expect(getValidOpenAICodexCredentials).toHaveBeenCalledTimes(1);
	});

	it("runs a strict forced refresh after an ordinary in-flight refresh", async () => {
		let releaseFirstRefresh!: () => void;
		const firstRefresh = new Promise<void>((resolve) => {
			releaseFirstRefresh = resolve;
		});
		getValidOpenAICodexCredentials
			.mockImplementationOnce(async () => {
				await firstRefresh;
				return {
					access: "access-new",
					refresh: "refresh-new",
					expires: Date.now() + 60_000,
				};
			})
			.mockResolvedValueOnce({
				access: "access-forced",
				refresh: "refresh-forced",
				expires: Date.now() + 60_000,
			});
		const stored = {
			provider: "openai-codex",
			auth: {
				accessToken: "access-old",
				refreshToken: "refresh-old",
				expiresAt: Date.now() - 1_000,
			},
		};
		const manager = new RuntimeOAuthTokenManager({
			providerSettingsManager: {
				getProviderSettings: vi.fn().mockReturnValue(stored),
				saveProviderSettings: vi.fn(),
				withProviderRefreshLock: vi.fn(
					async (_providerId: string, callback: () => Promise<unknown>) =>
						callback(),
				),
			} as never,
		});

		const ordinary = manager.resolveProviderApiKey({
			providerId: "openai-codex",
		});
		await vi.waitFor(() => {
			expect(getValidOpenAICodexCredentials).toHaveBeenCalledTimes(1);
		});
		const forced = manager.resolveProviderApiKey({
			providerId: "openai-codex",
			forceRefresh: true,
		});
		releaseFirstRefresh();

		await expect(Promise.all([ordinary, forced])).resolves.toMatchObject([
			{ apiKey: "access-new" },
			{ apiKey: "access-forced" },
		]);
		expect(getValidOpenAICodexCredentials).toHaveBeenCalledTimes(2);
		expect(getValidOpenAICodexCredentials.mock.calls[1]?.[1]).toMatchObject({
			forceRefresh: true,
		});
	});

	it("does not replay an ambiguous failed refresh for a forced waiter", async () => {
		let releaseRefresh!: () => void;
		const refreshBarrier = new Promise<void>((resolve) => {
			releaseRefresh = resolve;
		});
		getValidOpenAICodexCredentials.mockImplementationOnce(async () => {
			await refreshBarrier;
			return null;
		});
		const manager = new RuntimeOAuthTokenManager({
			providerSettingsManager: {
				getProviderSettings: vi.fn().mockReturnValue({
					provider: "openai-codex",
					auth: {
						accessToken: "access-old",
						refreshToken: "refresh-old",
						expiresAt: Date.now() - 1_000,
					},
				}),
				saveProviderSettings: vi.fn(),
				withProviderRefreshLock: vi.fn(
					async (_providerId: string, callback: () => Promise<unknown>) =>
						callback(),
				),
			} as never,
		});

		const ordinary = manager.resolveProviderApiKey({
			providerId: "openai-codex",
		});
		await vi.waitFor(() => {
			expect(getValidOpenAICodexCredentials).toHaveBeenCalledTimes(1);
		});
		const forced = manager.resolveProviderApiKey({
			providerId: "openai-codex",
			forceRefresh: true,
		});
		const ordinaryRejection = expect(ordinary).rejects.toBeInstanceOf(
			OAuthReauthRequiredError,
		);
		const forcedRejection = expect(forced).rejects.toBeInstanceOf(
			OAuthReauthRequiredError,
		);
		releaseRefresh();

		await ordinaryRejection;
		await forcedRejection;
		expect(getValidOpenAICodexCredentials).toHaveBeenCalledTimes(1);
	});
});
