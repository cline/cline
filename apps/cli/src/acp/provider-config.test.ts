import { describe, expect, it } from "vitest";
import {
	PROVIDER_CONFIG_CATEGORY,
	createProviderConfigOption,
} from "./provider-config";

describe("createProviderConfigOption", () => {
	it("keeps the provider selector out of the reserved model category", () => {
		const option = createProviderConfigOption("cline", [
			{ value: "cline", name: "Cline" },
			{ value: "openai-codex", name: "ChatGPT" },
		]);

		expect(option.category).toBe(PROVIDER_CONFIG_CATEGORY);
		expect(option.category).not.toBe("model");
		expect(option).toMatchObject({
			type: "select",
			id: "provider",
			name: "Provider",
			description: "The authentication provider to use",
			currentValue: "cline",
		});
		if (option.type !== "select") {
			throw new Error(`expected a select option, got ${option.type}`);
		}
		expect(option.options).toEqual([
			{ value: "cline", name: "Cline" },
			{ value: "openai-codex", name: "ChatGPT" },
		]);
	});
});
