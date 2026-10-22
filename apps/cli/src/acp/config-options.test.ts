import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import { describe, expect, it } from "vitest";
import {
	buildConfigOptions,
	buildProviderConfigOption,
	MODEL_CONFIG_CATEGORY,
	PROVIDER_CONFIG_CATEGORY,
} from "./config-options";

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

const providerOptions = [
	{ value: "cline", name: "Cline" },
	{ value: "openrouter", name: "OpenRouter" },
];

const organizationOption: SessionConfigOption = {
	type: "select",
	id: "organization",
	name: "Account",
	category: "_account",
	currentValue: "personal",
	options: [{ value: "personal", name: "Personal" }],
};

describe("buildProviderConfigOption", () => {
	it("builds the provider selector from the current provider", () => {
		const option = buildProviderConfigOption("cline", providerOptions);

		expect(option).toMatchObject({
			type: "select",
			id: "provider",
			currentValue: "cline",
			options: providerOptions,
		});
	});

	it("uses a custom category instead of a spec-reserved one", () => {
		const option = buildProviderConfigOption("cline", providerOptions);

		expect(option.category).toBe(PROVIDER_CONFIG_CATEGORY);
		expect(ACP_RESERVED_CATEGORIES).not.toContain(option.category);
		expect(option.category).toMatch(/^_/);
	});
});

describe.each([
	false,
	true,
])("ACP config options (organization: %s)", (includeOrganization) => {
	const options = buildConfigOptions({
		currentProviderId: "cline",
		providerOptions,
		currentModelId: "anthropic/claude-sonnet-5.5",
		providerModels,
		currentMode: "act",
		autoApproveTools: false,
		organizationOption: includeOrganization ? organizationOption : undefined,
	});

	it("tags only the model selector with the model category", () => {
		expect(
			options
				.filter((option) => option.category === MODEL_CONFIG_CATEGORY)
				.map((option) => option.id),
		).toEqual(["model"]);
	});

	it("uses reserved or custom category names for every option", () => {
		for (const { category } of options) {
			expect(
				category === undefined ||
					category === null ||
					ACP_RESERVED_CATEGORIES.includes(category) ||
					category.startsWith("_"),
			).toBe(true);
		}
	});

	it("does not repeat reserved categories in the assembled list", () => {
		const categories = options
			.map((option) => option.category)
			.filter(
				(category) => category && ACP_RESERVED_CATEGORIES.includes(category),
			);

		expect(new Set(categories).size).toBe(categories.length);
	});

	it("preserves the option order", () => {
		expect(options.map((option) => option.id)).toEqual([
			"provider",
			"model",
			"mode",
			"auto_approve",
			...(includeOrganization ? ["organization"] : []),
		]);
	});
});
