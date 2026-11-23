import { describe, expect, it } from "vitest";
import {
	resolveProviderApiKeyOptional,
	resolveProviderLocalCli,
} from "./provider-auth";

describe("resolveProviderApiKeyOptional", () => {
	it("reads an explicit optional-key declaration", () => {
		expect(
			resolveProviderApiKeyOptional({ metadata: { apiKeyOptional: true } }),
		).toBe(true);
	});
	it.each([
		undefined,
		{},
		{ metadata: {} },
		{ metadata: { apiKeyOptional: false } },
		{ metadata: { apiKeyOptional: "true" } },
	])("defaults to requiring a key: %j", (provider) => {
		expect(resolveProviderApiKeyOptional(provider)).toBe(false);
	});
});

describe("resolveProviderLocalCli", () => {
	it("extracts custom CLI metadata without a registry", () => {
		expect(
			resolveProviderLocalCli({
				metadata: { localCliCommand: " vendor " },
				docsUrl: "https://example.com/install",
			}),
		).toEqual({ command: "vendor", docsUrl: "https://example.com/install" });
	});
	it.each([
		undefined,
		{},
		{ metadata: {} },
		{ metadata: { localCliCommand: "  " } },
		{ metadata: { localCliCommand: 42 } },
	])("ignores missing or invalid CLI declarations: %j", (provider) => {
		expect(resolveProviderLocalCli(provider)).toBeUndefined();
	});
});
