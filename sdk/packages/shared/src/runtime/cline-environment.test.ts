import { describe, expect, it } from "vitest";
import {
	CLINE_ENVIRONMENT_ENV,
	CLINE_ENVIRONMENT_OVERRIDE_ENV,
	CLINE_ENVIRONMENTS,
	DEFAULT_CLINE_ENVIRONMENT,
	getClineEnvironmentConfig,
	resolveClineEnvironment,
} from "./cline-environment";

describe("resolveClineEnvironment", () => {
	it("defaults to production when no env var is set", () => {
		expect(resolveClineEnvironment({ env: {} })).toBe("production");
	});

	it("reads CLINE_ENVIRONMENT", () => {
		expect(
			resolveClineEnvironment({
				env: { [CLINE_ENVIRONMENT_ENV]: "staging" },
			}),
		).toBe("staging");
		expect(
			resolveClineEnvironment({
				env: { [CLINE_ENVIRONMENT_ENV]: "local" },
			}),
		).toBe("local");
	});

	it("prefers CLINE_ENVIRONMENT_OVERRIDE over CLINE_ENVIRONMENT", () => {
		expect(
			resolveClineEnvironment({
				env: {
					[CLINE_ENVIRONMENT_OVERRIDE_ENV]: "local",
					[CLINE_ENVIRONMENT_ENV]: "staging",
				},
			}),
		).toBe("local");
	});

	it("normalizes case and surrounding whitespace", () => {
		expect(
			resolveClineEnvironment({
				env: { [CLINE_ENVIRONMENT_ENV]: "  STAGING  " },
			}),
		).toBe("staging");
	});

	it("ignores unknown values and falls through to the next source", () => {
		expect(
			resolveClineEnvironment({
				env: {
					[CLINE_ENVIRONMENT_OVERRIDE_ENV]: "qa",
					[CLINE_ENVIRONMENT_ENV]: "staging",
				},
			}),
		).toBe("staging");

		expect(
			resolveClineEnvironment({
				env: { [CLINE_ENVIRONMENT_ENV]: "qa" },
			}),
		).toBe(DEFAULT_CLINE_ENVIRONMENT);
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

	it("resolves from env when no explicit environment is passed", () => {
		expect(
			getClineEnvironmentConfig({
				env: { [CLINE_ENVIRONMENT_ENV]: "staging" },
			}),
		).toBe(CLINE_ENVIRONMENTS.staging);
	});

	it("falls back to production by default", () => {
		expect(getClineEnvironmentConfig({ env: {} })).toBe(
			CLINE_ENVIRONMENTS.production,
		);
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
