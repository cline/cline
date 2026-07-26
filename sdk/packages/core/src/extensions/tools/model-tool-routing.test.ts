import { describe, expect, it } from "vitest";
import { resolveToolRoutingConfig } from "./model-tool-routing";

describe("model tool routing", () => {
	it("applies matching custom rules in order", () => {
		const config = resolveToolRoutingConfig(
			"bedrock",
			"anthropic.claude-sonnet-4-6",
			"act",
			[
				{
					name: "claude-editor-off",
					mode: "act",
					modelIdIncludes: ["claude"],
					disableTools: ["editor"],
				},
				{
					name: "claude-apply-patch-on",
					mode: "act",
					modelIdIncludes: ["claude"],
					enableTools: ["apply_patch"],
				},
			],
		);

		expect(config.enableEditor).toBe(false);
		expect(config.enableApplyPatch).toBe(true);
	});

	it("returns empty config when no rules match", () => {
		const config = resolveToolRoutingConfig(
			"bedrock",
			"anthropic.claude-sonnet-4-6",
			"act",
			[
				{
					mode: "act",
					modelIdIncludes: ["gpt"],
					enableTools: ["apply_patch"],
				},
			],
		);

		expect(config).toEqual({});
	});

	it("can match provider-only rules", () => {
		const config = resolveToolRoutingConfig(
			"bedrock",
			"anthropic.claude-sonnet-4-6",
			"act",
			[
				{
					mode: "act",
					providerIdIncludes: ["bedrock"],
					enableTools: ["apply_patch"],
					disableTools: ["editor"],
				},
			],
		);

		expect(config.enableApplyPatch).toBe(true);
		expect(config.enableEditor).toBe(false);
	});
});
