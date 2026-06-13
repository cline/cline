import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	formatProviderOAuthApiKey,
	getPersistedProviderApiKey,
	getProviderAuthHandler,
	getProviderAuthStorageId,
	isOAuthProvider,
	loginAndSaveProviderOAuthCredentials,
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
		expect(getProviderAuthHandler("oca")?.providerId).toBe("oca");
		expect(getProviderAuthHandler("openai-codex")?.providerId).toBe(
			"openai-codex",
		);
		expect(getProviderAuthHandler("openai-codex-cli")).toBeUndefined();
		expect(isOAuthProvider("openai-codex-cli")).toBe(false);
	});

	it("returns storage provider IDs from handlers", () => {
		expect(getProviderAuthStorageId("cline")).toBe("cline");
		expect(getProviderAuthStorageId("oca")).toBe("oca");
		expect(getProviderAuthStorageId("openai-codex")).toBe("openai-codex");
		expect(getProviderAuthStorageId("openai-codex-cli")).toBeUndefined();
	});

	it("formats Cline WorkOS tokens without double-prefixing", () => {
		expect(formatProviderOAuthApiKey("cline", { access: "abc" })).toBe(
			"workos:abc",
		);
		expect(formatProviderOAuthApiKey("cline", { access: "workos:abc" })).toBe(
			"workos:abc",
		);
		expect(
			getPersistedProviderApiKey("cline", {
				provider: "cline",
				auth: { accessToken: "abc" },
			}),
		).toBe("workos:abc");
	});

	it("login/save stores credentials under handler storageProviderId", async () => {
		loginClineOAuth.mockResolvedValueOnce({
			access: "new-access",
			refresh: "new-refresh",
			expires: 4_000_000_000_000,
			accountId: "acct-new",
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
			},
		});
		expect(saveProviderSettings).toHaveBeenCalledWith(
			expect.objectContaining({ provider: "cline" }),
			{ tokenSource: "oauth" },
		);
	});
});
