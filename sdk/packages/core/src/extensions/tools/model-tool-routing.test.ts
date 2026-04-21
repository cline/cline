import { describe, expect, it } from "vitest";
import {
	DEFAULT_MODEL_TOOL_ROUTING_RULES,
	resolveToolRoutingConfig,
} from "./model-tool-routing";

describe("model tool routing", () => {
	it("applies default codex/gpt routing in act mode", () => {
		const config = resolveToolRoutingConfig(
			"openai",
			"openai/gpt-5.4",
			"act",
			DEFAULT_MODEL_TOOL_ROUTING_RULES,
		);

		expect(config.enableApplyPatch).toBe(true);
		expect(config.enableEditor).toBe(false);
	});

	it("does not apply default codex/gpt routing in plan mode", () => {
		const config = resolveToolRoutingConfig(
			"openai",
			"openai/gpt-5.4",
			"plan",
			DEFAULT_MODEL_TOOL_ROUTING_RULES,
		);

		expect(config).toEqual({});
	});

	it("applies matching custom rules in order", () => {
		const config = resolveToolRoutingConfig(
			"anthropic",
			"claude-sonnet-4-6",
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
			"anthropic",
			"claude-sonnet-4-6",
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
		const config = resolveToolRoutingConfig("openai", "o4-mini", "act", [
			{
				mode: "act",
				providerIdIncludes: ["openai"],
				enableTools: ["apply_patch"],
				disableTools: ["editor"],
			},
		]);

		expect(config.enableApplyPatch).toBe(true);
		expect(config.enableEditor).toBe(false);
	});
});
