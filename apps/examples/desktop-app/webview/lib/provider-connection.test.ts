import { afterEach, describe, expect, it, vi } from "vitest";
import { isProviderConnected } from "./provider-connection";
import type { Provider } from "./provider-schema";

function makeProvider(overrides: Partial<Provider>): Provider {
	return {
		id: "test",
		name: "Test",
		models: 0,
		color: "#000",
		letter: "T",
		enabled: false,
		...overrides,
	};
}

describe("isProviderConnected", () => {
	it("counts a provider with an API key", () => {
		expect(isProviderConnected(makeProvider({ apiKey: "sk-123" }))).toBe(true);
	});

	it("counts a provider with an OAuth access token", () => {
		expect(
			isProviderConnected(makeProvider({ oauthAccessTokenPresent: true })),
		).toBe(true);
	});

	it("ignores whitespace-only API keys on disabled providers", () => {
		expect(isProviderConnected(makeProvider({ apiKey: "   " }))).toBe(false);
	});

	it("never counts a disabled provider without credentials", () => {
		expect(
			isProviderConnected(makeProvider({ enabled: false, configured: true })),
		).toBe(false);
	});

	it("counts an enabled provider the sidecar reports as configured", () => {
		expect(
			isProviderConnected(
				makeProvider({ id: "ollama", enabled: true, configured: true }),
			),
		).toBe(true);
	});

	it("rejects an enabled provider without sidecar-verified credentials", () => {
		// Legacy VS Code migration can seed enabled entries (e.g. qwen-code,
		// sapaicore) holding only a default model and no credentials. Enabled
		// alone must not read as configured.
		expect(
			isProviderConnected(
				makeProvider({ id: "qwen-code", enabled: true, configured: false }),
			),
		).toBe(false);
		expect(
			isProviderConnected(makeProvider({ id: "sapaicore", enabled: true })),
		).toBe(false);
	});
});

const { login, openExternalUrl } = vi.hoisted(() => ({
	login: vi.fn(),
	openExternalUrl: vi.fn(),
}));
vi.mock("./hub-client", () => ({ hubAccount: { login } }));
vi.mock("@/lib/desktop-client", () => ({ openExternalUrl }));

describe("direct Hub provider OAuth", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		login.mockReset();
		openExternalUrl.mockReset();
	});
	it("opens the browser and clears device codes after completion", async () => {
		const { runProviderOAuthLogin } = await import("./provider-connection");
		const { getOAuthUserCode } = await import("./oauth-user-code");
		openExternalUrl.mockResolvedValue(undefined);
		login.mockImplementation(async (_provider, callbacks) => {
			callbacks.onAuth({ url: "https://example.test/auth" });
			callbacks.onUserCode("CODE");
			expect(getOAuthUserCode()).toBe("CODE");
			return { provider: "cline", accountId: "account" };
		});
		await expect(runProviderOAuthLogin("cline")).resolves.toMatchObject({
			accountId: "account",
		});
		expect(openExternalUrl).toHaveBeenCalledWith("https://example.test/auth");
		expect(getOAuthUserCode()).toBeNull();
	});
	it("waits for cancellation cleanup before allowing another screen to sign in", async () => {
		const { runProviderOAuthLogin, cancelClineOAuthLogin } = await import(
			"./provider-connection"
		);
		let finish!: (value: unknown) => void;
		login
			.mockImplementationOnce(
				(_provider, _callbacks, signal) =>
					new Promise((resolve) => {
						finish = resolve;
						signal.addEventListener("abort", () => {});
					}),
			)
			.mockResolvedValue({ provider: "cline", accountId: "account" });
		const first = runProviderOAuthLogin("cline");
		await vi.waitFor(() => expect(login).toHaveBeenCalledTimes(1));
		const cancel = cancelClineOAuthLogin();
		const next = runProviderOAuthLogin("cline");
		expect(login.mock.calls[0][2].aborted).toBe(true);
		await Promise.resolve();
		expect(login).toHaveBeenCalledTimes(1);
		finish({ provider: "cline" });
		await Promise.all([first, cancel, next]);
		expect(login).toHaveBeenCalledTimes(2);
	});
});
