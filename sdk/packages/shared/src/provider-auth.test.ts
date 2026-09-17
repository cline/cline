import { describe, expect, it } from "vitest";
import { resolveProviderLocalCli } from "./provider-auth";

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
