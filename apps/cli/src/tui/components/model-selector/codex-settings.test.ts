import { describe, expect, it, vi } from "vitest";
import {
	changeCodexSetting,
	codexCurrentThinking,
	codexEffortOptions,
	codexSettingsPatch,
	FAST_WARNING,
} from "./codex-settings";
import { buildModelOptions } from "./model-selector";

const [astra] = buildModelOptions({
	"gpt-6-astra": {
		id: "gpt-6-astra",
		name: "GPT-6 Astra",
		contextWindow: 1050000,
		maxTokens: 128000,
		capabilities: ["reasoning"],
		reasoningOptions: [
			{ type: "effort", values: ["low", "medium", "high", "xhigh", "max"] },
		],
	},
});
const levels = codexEffortOptions(astra);

vi.mock("@opentui-ui/dialog/react", () => ({ useDialogKeyboard: vi.fn() }));
vi.mock("../../hooks/use-theme", () => ({ useDialogPalette: () => ({}) }));

describe("independent Codex settings", () => {
	it.each([
		[false, "high", "none"],
		[false, undefined, "none"],
		[true, "high", "high"],
		[true, undefined, "medium"],
		[undefined, "high", "high"],
		[undefined, undefined, "none"],
	] as const)("displays thinking %s with stored effort %s as %s", (thinking, reasoningEffort, expected) => {
		expect(codexCurrentThinking({ thinking, reasoningEffort })).toBe(expected);
	});
	it("uses Astra metadata including max but not unsupported Off", () => {
		expect(levels).toEqual(["low", "medium", "high", "xhigh", "max"]);
		expect(
			changeCodexSetting({ thinking: "xhigh", fast: false }, "thinking", levels)
				.thinking,
		).toBe("max");
	});
	it.each([
		undefined,
		false,
		true,
	])("Fast-only apply preserves original reasoning with thinking %s", (thinking) => {
		const config = {
			thinking,
			reasoningEffort: undefined,
			thinkingBudget: 1234,
		};
		const current = {
			thinking: thinking ? ("medium" as const) : ("none" as const),
			fast: false,
		};
		const patch = codexSettingsPatch(
			current,
			changeCodexSetting(current, "fast", levels),
		);
		expect(patch).toEqual({ serviceTier: "priority" });
		expect({ ...config, ...patch }).toEqual({
			...config,
			serviceTier: "priority",
		});
	});
	it("does not invent efforts without metadata", () => {
		expect(codexEffortOptions()).toEqual([]);
		const current = { thinking: "high" as const, fast: false };
		expect(changeCodexSetting(current, "thinking", [])).toBe(current);
	});
	it("changes unsupported initial effort only on explicit thinking action", () => {
		const current = { thinking: "none" as const, fast: false };
		expect(codexSettingsPatch(current, current)).toEqual({
			serviceTier: undefined,
		});
		expect(changeCodexSetting(current, "thinking", levels).thinking).toBe(
			"low",
		);
		expect(changeCodexSetting(current, "thinking", levels, -1).thinking).toBe(
			"max",
		);
	});
	it.each([
		"none",
		"low",
		"medium",
		"high",
		"xhigh",
		"max",
	] as const)("toggles Fast without changing thinking %s", (thinking) => {
		const initial = { thinking, fast: false };
		const enabled = changeCodexSetting(initial, "fast", levels);
		expect(enabled).toEqual({ thinking, fast: true });
		expect(codexSettingsPatch(initial, enabled)).toEqual({
			serviceTier: "priority",
		});
		expect(changeCodexSetting(enabled, "fast", levels)).toEqual(initial);
		expect(initial.fast).toBe(false);
	});
	it.each([false, true])("cycles thinking without changing Fast %s", (fast) => {
		expect(
			changeCodexSetting({ thinking: "max", fast }, "thinking", levels),
		).toEqual({ thinking: "low", fast });
		expect(
			changeCodexSetting({ thinking: "low", fast }, "thinking", levels, -1),
		).toEqual({ thinking: "max", fast });
	});
	it("warns about quota and lack of backend guarantees before applying", () => {
		expect(FAST_WARNING).toContain("more quota");
		expect(FAST_WARNING).toContain("saved for this provider");
		expect(FAST_WARNING).toContain("depends on your account");
		expect(FAST_WARNING).toContain("not guaranteed");
	});
});
