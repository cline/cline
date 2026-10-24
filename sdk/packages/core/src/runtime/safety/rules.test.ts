import { describe, expect, it } from "vitest";
import type { RuleConfig } from "../../extensions/config/user-instruction-config-loader";
import {
	listEnabledRulesFromRecords,
	loadRulesForSystemPromptFromRecords,
	mergeRulesForSystemPrompt,
} from "./rules";

function rule(
	name: string,
	extra: Partial<RuleConfig> = {},
): { item: RuleConfig } {
	return {
		item: {
			name,
			instructions: `${name} instructions`,
			frontmatter: {},
			...extra,
		},
	};
}

describe("loadRulesForSystemPromptFromRecords", () => {
	it("renders enabled rules sorted by name, whatever order they were listed in", () => {
		expect(
			loadRulesForSystemPromptFromRecords([rule("zeta"), rule("alpha")]),
		).toBe(
			"\n\n# Rules\n## alpha\nalpha instructions\n\n## zeta\nzeta instructions",
		);
	});

	it("drops rules disabled via frontmatter", () => {
		const rules = listEnabledRulesFromRecords([
			rule("kept"),
			rule("off", { disabled: true }),
		]);

		expect(rules.map((entry) => entry.name)).toEqual(["kept"]);
	});

	it("renders nothing when no rule is enabled", () => {
		expect(loadRulesForSystemPromptFromRecords([])).toBe("");
		expect(
			loadRulesForSystemPromptFromRecords([rule("off", { disabled: true })]),
		).toBe("");
	});
});

describe("mergeRulesForSystemPrompt", () => {
	it("returns additional rules when watcher rules are absent", () => {
		expect(mergeRulesForSystemPrompt(undefined, "inline rules")).toBe(
			"inline rules",
		);
	});

	it("returns watcher rules when inline rules are absent", () => {
		expect(mergeRulesForSystemPrompt("watcher rules", undefined)).toBe(
			"watcher rules",
		);
	});

	it("appends inline rules after watcher rules", () => {
		expect(mergeRulesForSystemPrompt("watcher rules", "inline rules")).toBe(
			"watcher rules\n\ninline rules",
		);
	});
});
