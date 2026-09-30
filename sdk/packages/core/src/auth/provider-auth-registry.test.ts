import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	formatProviderOAuthApiKey,
	getPersistedProviderApiKey,
	getProviderAuthHandler,
	getProviderAuthStorageId,
	getProviderOAuthCredentialsFromSettings,
	isOAuthProvider,
	loginAndSaveProviderOAuthCredentials,
	resolveProviderApiKeyFromSettings,
} from "./provider-auth-registry";

const { loginClineOAuth } = vi.hoisted(() => ({
	loginClineOAuth: vi.fn(),
}));

vi.mock("./cline", () => ({
	getValidClineCredentials: vi.fn(),
	loginClineOAuth,
}));

vi.mock("./oca", () => ({
	getValidOcaCredentials: vi.fn(),
	loginOcaOAuth: vi.fn(),
}));

vi.mock("./codex", () => ({
	getValidOpenAICodexCredentials: vi.fn(),
	loginOpenAICodex: vi.fn(),
}));

describe("provider auth registry", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns handlers for managed OAuth providers only", () => {
		expect(getProviderAuthHandler("cline")?.providerId).toBe("cline");
		expect(getProviderAuthHandler("cline-pass")?.providerId).toBe("cline-pass");
		expect(getProviderAuthHandler("oca")?.providerId).toBe("oca");
		expect(getProviderAuthHandler("openai-codex")?.providerId).toBe(
			"openai-codex",
		);
		expect(getProviderAuthHandler("openai-codex-cli")).toBeUndefined();
		expect(isOAuthProvider("openai-codex-cli")).toBe(false);
	});

	it("returns storage provider IDs from handlers", () => {
		expect(getProviderAuthStorageId("cline")).toBe("cline");
		expect(getProviderAuthStorageId("cline-pass")).toBe("cline");
		expect(getProviderAuthStorageId("oca")).toBe("oca");
		expect(getProviderAuthStorageId("openai-codex")).toBe("openai-codex");
		expect(getProviderAuthStorageId("openai-codex-cli")).toBeUndefined();
	});

	it("formats Cline WorkOS tokens without double-prefixing", () => {
		expect(formatProviderOAuthApiKey("cline", { access: "abc" })).toBe(
			"workos:abc",
		);
		expect(formatProviderOAuthApiKey("cline-pass", { access: "abc" })).toBe(
			"workos:abc",
		);
		expect(formatProviderOAuthApiKey("cline", { access: "workos:abc" })).toBe(
			"workos:abc",
		);
		expect(
			getPersistedProviderApiKey("cline-pass", {
				provider: "cline",
				auth: { accessToken: "abc" },
			}),
		).toBe("workos:abc");
	});

	it("login/save for ClinePass stores credentials under Cline storage", async () => {
		loginClineOAuth.mockResolvedValueOnce({
			access: "new-access",
			refresh: "new-refresh",
			expires: 4_000_000_000_000,
			accountId: "acct-new",
			metadata: { sessionStartedAtMs: 1_700_000_000_000 },
		});
		const getProviderSettings = vi.fn().mockReturnValue({
			provider: "cline",
			apiKey: "manual-key",
		});
		const saveProviderSettings = vi.fn();
		const manager = {
			getProviderSettings,
			saveProviderSettings,
		} as never;

		const saved = await loginAndSaveProviderOAuthCredentials(
			manager,
			"cline-pass",
			{
				callbacks: {
					onAuth: vi.fn(),
					onPrompt: vi.fn(async () => ""),
				},
			},
		);

		expect(getProviderSettings).toHaveBeenCalledWith("cline");
		expect(saved).toMatchObject({
			provider: "cline",
			apiKey: "manual-key",
			auth: {
				accessToken: "workos:new-access",
				refreshToken: "new-refresh",
				accountId: "acct-new",
				expiresAt: 4_000_000_000_000,
				metadata: { sessionStartedAtMs: 1_700_000_000_000 },
			},
		});
		expect(saveProviderSettings).toHaveBeenCalledWith(
			expect.objectContaining({ provider: "cline" }),
			{ tokenSource: "oauth" },
		);
	});

	it("ClinePass resolves API keys from Cline storage", () => {
		const getProviderSettings = vi.fn().mockReturnValue({
			provider: "cline",
			auth: { accessToken: "abc" },
		});
		const manager = { getProviderSettings } as never;

		expect(resolveProviderApiKeyFromSettings(manager, "cline-pass")).toBe(
			"workos:abc",
		);
		expect(getProviderSettings).toHaveBeenCalledWith("cline");
	});

	it("login/save stores credentials under handler storageProviderId", async () => {
		loginClineOAuth.mockResolvedValueOnce({
			access: "new-access",
			refresh: "new-refresh",
			expires: 4_000_000_000_000,
			accountId: "acct-new",
			metadata: { sessionStartedAtMs: 1_700_000_000_001 },
		});
		const getProviderSettings = vi.fn().mockReturnValue({
			provider: "cline",
			apiKey: "manual-key",
		});
		const saveProviderSettings = vi.fn();
		const manager = {
			getProviderSettings,
			saveProviderSettings,
		} as never;

		const saved = await loginAndSaveProviderOAuthCredentials(manager, "cline", {
			callbacks: {
				onAuth: vi.fn(),
				onPrompt: vi.fn(async () => ""),
			},
		});

		expect(getProviderSettings).toHaveBeenCalledWith("cline");
		expect(saved).toMatchObject({
			provider: "cline",
			apiKey: "manual-key",
			auth: {
				accessToken: "workos:new-access",
				refreshToken: "new-refresh",
				accountId: "acct-new",
				expiresAt: 4_000_000_000_000,
				metadata: { sessionStartedAtMs: 1_700_000_000_001 },
			},
		});
		expect(saveProviderSettings).toHaveBeenCalledWith(
			expect.objectContaining({ provider: "cline" }),
			{ tokenSource: "oauth" },
		);
	});

	it("login/save preserves existing auth metadata when incoming metadata is missing", async () => {
		loginClineOAuth.mockResolvedValueOnce({
			access: "new-access",
			refresh: "new-refresh",
			expires: 4_000_000_000_000,
			accountId: "acct-new",
		});
		const getProviderSettings = vi.fn().mockReturnValue({
			provider: "cline",
			auth: {
				accessToken: "workos:old-access",
				refreshToken: "old-refresh",
				accountId: "acct-old",
				metadata: {
					provider: "workos",
					sessionStartedAtMs: 1_700_000_000_003,
				},
			},
		});
		const saveProviderSettings = vi.fn();
		const manager = {
			getProviderSettings,
			saveProviderSettings,
		} as never;

		const saved = await loginAndSaveProviderOAuthCredentials(manager, "cline", {
			callbacks: {
				onAuth: vi.fn(),
				onPrompt: vi.fn(async () => ""),
			},
		});

		expect(saved).toMatchObject({
			auth: {
				accessToken: "workos:new-access",
				metadata: {
					provider: "workos",
					sessionStartedAtMs: 1_700_000_000_003,
				},
			},
		});
	});

	it("login/save does not let undefined incoming metadata erase existing metadata", async () => {
		loginClineOAuth.mockResolvedValueOnce({
			access: "new-access",
			refresh: "new-refresh",
			expires: 4_000_000_000_000,
			accountId: "acct-new",
			metadata: { provider: undefined, tokenType: "Bearer" },
		});
		const getProviderSettings = vi.fn().mockReturnValue({
			provider: "cline",
			auth: {
				accessToken: "workos:old-access",
				refreshToken: "old-refresh",
				accountId: "acct-old",
				metadata: {
					provider: "workos",
					sessionStartedAtMs: 1_700_000_000_004,
				},
			},
		});
		const saveProviderSettings = vi.fn();
		const manager = {
			getProviderSettings,
			saveProviderSettings,
		} as never;

		const saved = await loginAndSaveProviderOAuthCredentials(manager, "cline", {
			callbacks: {
				onAuth: vi.fn(),
				onPrompt: vi.fn(async () => ""),
			},
		});

		expect(saved).toMatchObject({
			auth: {
				accessToken: "workos:new-access",
				metadata: {
					provider: "workos",
					sessionStartedAtMs: 1_700_000_000_004,
					tokenType: "Bearer",
				},
			},
		});
	});

	it("reads persisted auth metadata back into OAuth credentials", () => {
		const handler = getProviderAuthHandler("cline");
		const credentials =
			handler &&
			getProviderOAuthCredentialsFromSettings("cline", {
				provider: "cline",
				auth: {
					accessToken: "workos:stored-access",
					refreshToken: "stored-refresh",
					expiresAt: 4_000_000_000_000,
					accountId: "acct-stored",
					metadata: { sessionStartedAtMs: 1_700_000_000_002 },
				},
			});

		expect(credentials).toMatchObject({
			access: "stored-access",
			refresh: "stored-refresh",
			accountId: "acct-stored",
			metadata: { sessionStartedAtMs: 1_700_000_000_002 },
		});
	});
});

describe("ChatGPT plan credential gate", () => {
	const grant = {
		clientId: "oaiapp_test",
		issuer: "https://auth.openai.com",
		subject: "subject",
		scopes: ["chatgpt.tokens.use.direct"],
	};
	it.each([
		undefined,
		{},
		{ ...grant, scopes: [] },
		{ ...grant, scopes: ["chatgpt.tokens.use.direct.extra"] },
	])("never falls back to an API key or ungranted token", (metadata) => {
		const settings = {
			provider: "openai-chatgpt",
			apiKey: "manual",
			auth: { accessToken: "access", apiKey: "other", metadata },
		};
		expect(
			getProviderAuthHandler(settings.provider)?.isConfigured(settings),
		).toBe(false);
		expect(
			getPersistedProviderApiKey(settings.provider, settings),
		).toBeUndefined();
		expect(() =>
			formatProviderOAuthApiKey(settings.provider, {
				access: "access",
				metadata,
			}),
		).toThrow("not been granted");
	});
	it("enables the issued token after the required grant is persisted", () => {
		const settings = {
			provider: "openai-chatgpt",
			auth: { accessToken: "access", metadata: grant },
		};
		expect(
			getProviderAuthHandler(settings.provider)?.isConfigured(settings),
		).toBe(true);
		expect(getPersistedProviderApiKey(settings.provider, settings)).toBe(
			"access",
		);
	});
});
