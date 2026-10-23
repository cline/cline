import { afterEach, describe, expect, it, vi } from "vitest";
import {
	DEFAULT_ENVIRONMENT,
	ENVIRONMENTS,
	isEnvironmentName,
	resolveDevHubEndpoint,
	resolveEnvironment,
} from "./env";

afterEach(() => {
	vi.unstubAllEnvs();
	vi.resetModules();
});

describe("ENVIRONMENTS", () => {
	it("points staging at the staging hosts", () => {
		expect(ENVIRONMENTS.staging).toEqual({
			name: "staging",
			sessionBaseUrl: "https://session.staging.cline.bot",
			apiBaseUrl: "https://api.staging.cline.bot",
		});
	});

	it("points production at the production hosts", () => {
		expect(ENVIRONMENTS.production).toEqual({
			name: "production",
			sessionBaseUrl: "https://session.cline.bot",
			apiBaseUrl: "https://api.cline.bot",
		});
	});

	it("never uses a trailing slash", () => {
		for (const config of Object.values(ENVIRONMENTS)) {
			expect(config.sessionBaseUrl.endsWith("/")).toBe(false);
			expect(config.apiBaseUrl.endsWith("/")).toBe(false);
		}
	});
});

describe("resolveEnvironment", () => {
	it("defaults to staging when unset", () => {
		expect(resolveEnvironment(undefined)).toBe(ENVIRONMENTS.staging);
		expect(resolveEnvironment(null)).toBe(ENVIRONMENTS.staging);
		expect(resolveEnvironment("")).toBe(ENVIRONMENTS.staging);
		expect(DEFAULT_ENVIRONMENT).toBe(ENVIRONMENTS.staging);
	});

	it("selects production when asked explicitly", () => {
		const resolved = resolveEnvironment("production");
		expect(resolved).toBe(ENVIRONMENTS.production);
		expect(resolved.apiBaseUrl).toBe("https://api.cline.bot");
		expect(resolved.sessionBaseUrl).toBe("https://session.cline.bot");
	});

	it("selects staging when asked explicitly", () => {
		expect(resolveEnvironment("staging")).toBe(ENVIRONMENTS.staging);
	});

	it("tolerates surrounding whitespace and casing", () => {
		expect(resolveEnvironment("  PRODUCTION ")).toBe(ENVIRONMENTS.production);
	});

	it("falls back to staging for unknown names", () => {
		expect(resolveEnvironment("prod")).toBe(ENVIRONMENTS.staging);
		expect(resolveEnvironment("nonsense")).toBe(ENVIRONMENTS.staging);
	});
});

describe("isEnvironmentName", () => {
	it("narrows only the two known names", () => {
		expect(isEnvironmentName("staging")).toBe(true);
		expect(isEnvironmentName("production")).toBe(true);
		expect(isEnvironmentName("prod")).toBe(false);
		expect(isEnvironmentName(undefined)).toBe(false);
		expect(isEnvironmentName(7)).toBe(false);
	});
});

describe("resolveDevHubEndpoint", () => {
	it("is undefined when no dev-hub url is set", () => {
		vi.stubEnv("EXPO_PUBLIC_DEV_HUB_URL", undefined);
		expect(resolveDevHubEndpoint()).toBeUndefined();
	});

	it("reads url alone", () => {
		vi.stubEnv("EXPO_PUBLIC_DEV_HUB_URL", "ws://127.0.0.1:4599/hub");
		vi.stubEnv("EXPO_PUBLIC_DEV_HUB_TOKEN", undefined);
		expect(resolveDevHubEndpoint()).toEqual({
			url: "ws://127.0.0.1:4599/hub",
		});
	});

	it("reads url + token, trimming whitespace", () => {
		vi.stubEnv("EXPO_PUBLIC_DEV_HUB_URL", "  ws://127.0.0.1:4599/hub ");
		vi.stubEnv("EXPO_PUBLIC_DEV_HUB_TOKEN", " secret ");
		expect(resolveDevHubEndpoint()).toEqual({
			url: "ws://127.0.0.1:4599/hub",
			authToken: "secret",
		});
	});
});

describe("the module-level env binding", () => {
	it("reads EXPO_PUBLIC_ENV", async () => {
		vi.stubEnv("EXPO_PUBLIC_ENV", "production");
		vi.resetModules();
		const mod = await import("./env");
		expect(mod.env.name).toBe("production");
	});

	it("defaults to staging when EXPO_PUBLIC_ENV is absent", async () => {
		vi.stubEnv("EXPO_PUBLIC_ENV", undefined);
		vi.resetModules();
		const mod = await import("./env");
		expect(mod.env.name).toBe("staging");
	});
});
