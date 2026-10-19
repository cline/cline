import { describe, expect, it } from "vitest";
import {
	buildModelConfigOption,
	buildProviderConfigOption,
	MODEL_CONFIG_CATEGORY,
	PROVIDER_CONFIG_CATEGORY,
} from "./config-options";

const providerChoices = [
	{ value: "cline", name: "Cline" },
	{ value: "openai-codex", name: "ChatGPT" },
];

const providerModels = {
	"anthropic/claude-sonnet-5.5": { name: "Claude Sonnet 5.5" },
	"openrouter/free": { name: "Free", description: "A free model" },
};

describe("buildProviderConfigOption", () => {
	it("builds the provider selector with the given choices", () => {
		const option = buildProviderConfigOption("cline", providerChoices);
		expect(option).toMatchObject({
			type: "select",
			id: "provider",
			name: "Provider",
			currentValue: "cline",
		});
		if (option.type !== "select") {
			throw new Error(`expected a select option, got ${option.type}`);
		}
		expect(option.options).toEqual(providerChoices);
	});

	it("uses a custom `_`-prefixed category, never a spec-reserved one", () => {
		const option = buildProviderConfigOption("cline", providerChoices);
		expect(option.category).toBe(PROVIDER_CONFIG_CATEGORY);
		// ACP reserves every category name that does not start with `_`.
		expect(option.category).toMatch(/^_/);
	});
});

describe("buildModelConfigOption", () => {
	it("maps the provider's catalog into select options", () => {
		const option = buildModelConfigOption(
			"anthropic/claude-sonnet-5.5",
			providerModels,
		);
		expect(option).toMatchObject({
			type: "select",
			id: "model",
			category: MODEL_CONFIG_CATEGORY,
			currentValue: "anthropic/claude-sonnet-5.5",
		});
		if (option.type !== "select") {
			throw new Error(`expected a select option, got ${option.type}`);
		}
		expect(option.options).toEqual([
			{
				value: "anthropic/claude-sonnet-5.5",
				name: "Claude Sonnet 5.5",
				description: undefined,
			},
			{ value: "openrouter/free", name: "Free", description: "A free model" },
		]);
	});
});

describe("ACP config option categories", () => {
	// Regression for cline/cline#15158: `provider` was listed first and also
	// tagged `model`, so spec-following clients (which break category ties by
	// array order) treated it as the model selector and wrote model ids into it.
	it("only the model option carries the reserved `model` category", () => {
		const configOptions = [
			buildProviderConfigOption("cline", providerChoices),
			buildModelConfigOption("anthropic/claude-sonnet-5.5", providerModels),
		];
		const modelCategory = configOptions.filter((o) => o.category === "model");
		expect(modelCategory.map((o) => o.id)).toEqual(["model"]);
	});
});
