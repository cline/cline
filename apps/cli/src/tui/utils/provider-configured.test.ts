import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TuiProps } from "../types";
import {
	hasProviderApiKeyInEnv,
	isProviderConfigured,
} from "./provider-configured";

const ENV_KEY = "OPENROUTER_API_KEY";
const SETTINGS_PATH_KEY = "CLINE_PROVIDER_SETTINGS_PATH";
const previous = process.env[ENV_KEY];
const previousSettingsPath = process.env[SETTINGS_PATH_KEY];
let settingsDir: string;

function tuiConfig(providerId: string): TuiProps["config"] {
	return { providerId, apiKey: "" } as TuiProps["config"];
}

function restore(key: string, value: string | undefined): void {
	if (value === undefined) delete process.env[key];
	else process.env[key] = value;
}

describe("isProviderConfigured", () => {
	beforeEach(() => {
		settingsDir = mkdtempSync(join(tmpdir(), "cline-provider-configured-"));
		process.env[SETTINGS_PATH_KEY] = join(settingsDir, "providers.json");
	});

	afterEach(() => {
		restore(ENV_KEY, previous);
		restore(SETTINGS_PATH_KEY, previousSettingsPath);
		rmSync(settingsDir, { recursive: true, force: true });
	});

	it("finds a key in the provider's documented environment variables", () => {
		expect(
			hasProviderApiKeyInEnv("openrouter", { [ENV_KEY]: "sk-or-test" }),
		).toBe(true);
		expect(hasProviderApiKeyInEnv("openrouter", { [ENV_KEY]: "  " })).toBe(
			false,
		);
		expect(hasProviderApiKeyInEnv("openrouter", {})).toBe(false);
		expect(
			hasProviderApiKeyInEnv("not-a-provider", { [ENV_KEY]: "sk-or-test" }),
		).toBe(false);
	});

	it("treats an environment-only key as configured instead of onboarding", () => {
		delete process.env[ENV_KEY];
		expect(isProviderConfigured(tuiConfig("openrouter"))).toBe(false);

		process.env[ENV_KEY] = "sk-or-test";
		expect(isProviderConfigured(tuiConfig("openrouter"))).toBe(true);
	});

	it("configures OpenRouter from OPENROUTER_API_KEY", () => {
		expect(
			isProviderConfigured(tuiConfig("openrouter"), {
				OPENROUTER_API_KEY: "sk-or-test",
			}),
		).toBe(true);
	});

	it("keeps onboarding for providers with several environment variables", () => {
		expect(
			isProviderConfigured(tuiConfig("bedrock"), { AWS_REGION: "us-east-1" }),
		).toBe(false);
		expect(
			isProviderConfigured(tuiConfig("vertex"), {
				GOOGLE_CLOUD_PROJECT: "my-project",
			}),
		).toBe(false);
	});
});
