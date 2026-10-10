import { describe, expect, it } from "vitest";
import {
	buildProviderConfigOption,
	requiresAcpProviderAuth,
	resolveAcpProviderApiKey,
	selectableAcpProviders,
} from "./providers";

const authMethods = [
	{ id: "cline", name: "Cline Usage-Billing" },
	{ id: "cline-pass", name: "ClinePass" },
	{ id: "openai-codex", name: "OpenAI ChatGPT Subscription" },
];

describe("selectableAcpProviders", () => {
	it("offers a provider configured with an API key", () => {
		const selectable = selectableAcpProviders({
			authMethods,
			configured: [{ id: "mistral", name: "Mistral" }],
		});
		expect(selectable.map((choice) => choice.id)).toEqual([
			"cline",
			"cline-pass",
			"openai-codex",
			"mistral",
		]);
	});

	it("lists a provider that is both an auth method and configured once, in auth-method order", () => {
		const selectable = selectableAcpProviders({
			authMethods,
			configured: [
				{ id: "mistral", name: "Mistral" },
				{ id: "cline", name: "Cline Usage-Billing" },
			],
		});
		expect(selectable.map((choice) => choice.id)).toEqual([
			"cline",
			"cline-pass",
			"openai-codex",
			"mistral",
		]);
	});

	it("falls back to the sign-in methods when nothing is configured", () => {
		expect(selectableAcpProviders({ authMethods, configured: [] })).toEqual(
			authMethods,
		);
	});
});

describe("buildProviderConfigOption", () => {
	it("lists the sign-in methods followed by the configured providers", () => {
		const option = buildProviderConfigOption({
			authMethods: [{ id: "cline", name: "Cline Usage-Billing" }],
			configured: [{ id: "mistral", name: "Mistral" }],
			currentProviderId: "mistral",
		});
		expect(option.id).toBe("provider");
		if (option.type !== "select") {
			throw new Error(`expected a select option, got ${option.type}`);
		}
		expect(option.currentValue).toBe("mistral");
		expect(option.options).toEqual([
			{ value: "cline", name: "Cline Usage-Billing" },
			{ value: "mistral", name: "Mistral" },
		]);
	});

	it("preserves the current provider when it is a sign-in method", () => {
		const option = buildProviderConfigOption({
			authMethods: [{ id: "cline", name: "Cline Usage-Billing" }],
			configured: [],
			currentProviderId: "cline",
		});
		if (option.type !== "select") {
			throw new Error(`expected a select option, got ${option.type}`);
		}
		expect(option.currentValue).toBe("cline");
	});
});

describe("requiresAcpProviderAuth", () => {
	it("requires a sign-in for an OAuth provider with no stored credentials", () => {
		expect(
			requiresAcpProviderAuth({ isOAuthProvider: true, isConfigured: false }),
		).toBe(true);
	});

	it("still requires a sign-in when an OAuth provider has a credential-free entry", () => {
		expect(
			requiresAcpProviderAuth({ isOAuthProvider: true, isConfigured: true }),
		).toBe(true);
	});

	it("allows a configured provider that needs no key", () => {
		expect(
			requiresAcpProviderAuth({ isOAuthProvider: false, isConfigured: true }),
		).toBe(false);
	});

	it("allows an OAuth provider once its key is stored", () => {
		expect(
			requiresAcpProviderAuth({
				isOAuthProvider: true,
				isConfigured: false,
				persistedApiKey: "stored-key",
			}),
		).toBe(false);
	});

	it("allows anything when the environment supplies a key", () => {
		expect(
			requiresAcpProviderAuth({
				isOAuthProvider: true,
				isConfigured: false,
				envApiKey: "env-key",
			}),
		).toBe(false);
	});

	it("rejects an unconfigured provider that is not an auth method", () => {
		expect(
			requiresAcpProviderAuth({ isOAuthProvider: false, isConfigured: false }),
		).toBe(true);
	});
});

describe("resolveAcpProviderApiKey", () => {
	it("never hands the sign-in key to a different provider", () => {
		expect(
			resolveAcpProviderApiKey({
				providerId: "mistral",
				authProviderId: "cline",
				authApiKey: "cline-oauth-token",
			}),
		).toBe("");
	});

	it("uses the persisted key of the selected provider", () => {
		expect(
			resolveAcpProviderApiKey({
				providerId: "mistral",
				persistedApiKey: "mistral-key",
				authProviderId: "cline",
				authApiKey: "cline-oauth-token",
			}),
		).toBe("mistral-key");
	});

	it("falls back to the sign-in key only for the provider that signed in", () => {
		expect(
			resolveAcpProviderApiKey({
				providerId: "cline",
				authProviderId: "cline",
				authApiKey: "cline-oauth-token",
			}),
		).toBe("cline-oauth-token");
	});

	it("returns an empty key for a keyless local provider", () => {
		expect(
			resolveAcpProviderApiKey({
				providerId: "ollama",
				authProviderId: "cline",
				authApiKey: "cline-oauth-token",
			}),
		).toBe("");
	});

	it("lets the environment override everything", () => {
		expect(
			resolveAcpProviderApiKey({
				providerId: "mistral",
				envApiKey: "env-key",
				persistedApiKey: "mistral-key",
			}),
		).toBe("env-key");
	});
});
