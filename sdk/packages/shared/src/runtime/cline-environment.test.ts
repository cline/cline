import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	CLINE_ENVIRONMENT_ENV,
	CLINE_ENVIRONMENT_OVERRIDE_ENV,
	CLINE_ENVIRONMENTS,
	DEFAULT_CLINE_ENVIRONMENT,
	getClineEnvironmentConfig,
	resolveClineEnvironment,
} from "./cline-environment";

const ENV_KEYS = [
	CLINE_ENVIRONMENT_ENV,
	CLINE_ENVIRONMENT_OVERRIDE_ENV,
	"CLINE_API_BASE_URL",
] as const;

const originalEnvValues = Object.fromEntries(
	ENV_KEYS.map((key) => [key, process.env[key]]),
);

beforeEach(() => {
	vi.unstubAllGlobals();
	for (const key of ENV_KEYS) {
		delete process.env[key];
	}
});

afterEach(() => {
	vi.unstubAllGlobals();
	for (const key of ENV_KEYS) {
		const value = originalEnvValues[key];
		if (typeof value === "string") {
			process.env[key] = value;
		} else {
			delete process.env[key];
		}
	}
});

describe("resolveClineEnvironment", () => {
	it("defaults to production when no env var is set", () => {
		expect(resolveClineEnvironment()).toBe(DEFAULT_CLINE_ENVIRONMENT);
	});

	it("reads CLINE_ENVIRONMENT from process.env", () => {
		process.env[CLINE_ENVIRONMENT_ENV] = "staging";
		expect(resolveClineEnvironment()).toBe("staging");

		process.env[CLINE_ENVIRONMENT_ENV] = "local";
		expect(resolveClineEnvironment()).toBe("local");
	});

	it("prefers CLINE_ENVIRONMENT_OVERRIDE over CLINE_ENVIRONMENT", () => {
		process.env[CLINE_ENVIRONMENT_OVERRIDE_ENV] = "local";
		process.env[CLINE_ENVIRONMENT_ENV] = "staging";

		expect(resolveClineEnvironment()).toBe("local");
	});

	it("normalizes case and surrounding whitespace", () => {
		process.env[CLINE_ENVIRONMENT_ENV] = "  STAGING  ";

		expect(resolveClineEnvironment()).toBe("staging");
	});

	it("ignores unknown values and falls through to the next source", () => {
		process.env[CLINE_ENVIRONMENT_OVERRIDE_ENV] = "qa";
		process.env[CLINE_ENVIRONMENT_ENV] = "staging";
		expect(resolveClineEnvironment()).toBe("staging");

		delete process.env[CLINE_ENVIRONMENT_OVERRIDE_ENV];
		process.env[CLINE_ENVIRONMENT_ENV] = "qa";
		expect(resolveClineEnvironment()).toBe(DEFAULT_CLINE_ENVIRONMENT);
	});

	it("defaults to production when process is unavailable", () => {
		vi.stubGlobal("process", undefined);

		expect(resolveClineEnvironment()).toBe(DEFAULT_CLINE_ENVIRONMENT);
	});
});

describe("getClineEnvironmentConfig", () => {
	it("returns the config for an explicit environment", () => {
		expect(getClineEnvironmentConfig("staging")).toBe(
			CLINE_ENVIRONMENTS.staging,
		);
		expect(getClineEnvironmentConfig("local")).toBe(CLINE_ENVIRONMENTS.local);
		expect(getClineEnvironmentConfig("production")).toBe(
			CLINE_ENVIRONMENTS.production,
		);
	});

	it("falls back to production by default", () => {
		expect(getClineEnvironmentConfig()).toBe(CLINE_ENVIRONMENTS.production);
	});

	it("uses the resolved process.env environment when no explicit environment is provided", () => {
		process.env[CLINE_ENVIRONMENT_ENV] = "staging";

		expect(getClineEnvironmentConfig()).toBe(CLINE_ENVIRONMENTS.staging);
	});

	it("applies CLINE_API_BASE_URL without mutating the catalog config", () => {
		process.env.CLINE_API_BASE_URL = "http://127.0.0.1:3000";

		expect(getClineEnvironmentConfig("local")).toEqual({
			...CLINE_ENVIRONMENTS.local,
			apiBaseUrl: "http://127.0.0.1:3000",
		});
		expect(CLINE_ENVIRONMENTS.local.apiBaseUrl).toBe("http://localhost:3000");
		expect(CLINE_ENVIRONMENTS.local.mcpBaseUrl).toBe("http://localhost:3000");
	});

	it("defaults to production when process is unavailable", () => {
		vi.stubGlobal("process", undefined);

		expect(getClineEnvironmentConfig()).toBe(CLINE_ENVIRONMENTS.production);
	});
});

describe("CLINE_ENVIRONMENTS catalog", () => {
	it("exposes an environment field that matches its key", () => {
		for (const [key, config] of Object.entries(CLINE_ENVIRONMENTS)) {
			expect(config.environment).toBe(key);
		}
	});

	it("populates appBaseUrl, apiBaseUrl, and mcpBaseUrl for every environment", () => {
		for (const config of Object.values(CLINE_ENVIRONMENTS)) {
			expect(config.appBaseUrl).toMatch(/^https?:\/\//);
			expect(config.apiBaseUrl).toMatch(/^https?:\/\//);
			expect(config.mcpBaseUrl).toMatch(/^https?:\/\//);
		}
	});
});
