import { describe, expect, it } from "vitest";
import { buildModelConfigOption, buildProviderConfigOption } from "./acpAgent";

// ACP reserves every category name that does not start with `_` for the spec.
const ACP_RESERVED_CATEGORIES = [
	"mode",
	"model",
	"model_config",
	"thought_level",
];

const providerModels = {
	"anthropic/claude-sonnet-5.5": { name: "Claude Sonnet 5.5" },
	"openrouter/free": { name: "Free" },
};

describe("buildProviderConfigOption", () => {
	it("builds the provider selector from the current provider", async () => {
		const option = await buildProviderConfigOption("cline");

		expect(option).toMatchObject({
			type: "select",
			id: "provider",
			currentValue: "cline",
		});
	});

	it("uses a custom category instead of a spec-reserved one", async () => {
		const option = await buildProviderConfigOption("cline");

		expect(ACP_RESERVED_CATEGORIES).not.toContain(option.category);
		expect(option.category).toMatch(/^_/);
	});
});

describe("ACP config options", () => {
	it("gives the provider and model selectors distinct categories", async () => {
		const provider = await buildProviderConfigOption("cline");
		const model = buildModelConfigOption(
			"anthropic/claude-sonnet-5.5",
			providerModels,
		);

		// Clients resolve options that share a category by array order and
		// prefer the earlier one, which made the provider selector win.
		expect(provider.category).not.toBe(model.category);
		expect(model.category).toBe("model");
	});
});
