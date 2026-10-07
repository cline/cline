import { afterEach, describe, expect, it } from "vitest";
import type { TuiProps } from "../types";
import {
	hasProviderApiKeyInEnv,
	isProviderConfigured,
} from "./provider-configured";

const ENV_KEY = "OPENROUTER_API_KEY";
const previous = process.env[ENV_KEY];

function tuiConfig(providerId: string): TuiProps["config"] {
	return { providerId, apiKey: "" } as TuiProps["config"];
}

describe("isProviderConfigured", () => {
	afterEach(() => {
		if (previous === undefined) delete process.env[ENV_KEY];
		else process.env[ENV_KEY] = previous;
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
});
