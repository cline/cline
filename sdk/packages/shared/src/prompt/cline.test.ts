import { describe, expect, it } from "vitest";
import {
	buildClineSystemPrompt,
	MODE_CONTRACTS,
	MODE_CONTRACTS_MANUAL_SWITCH,
	MODE_TAG_INSTRUCTIONS,
	processWorkspaceInfo,
} from "./cline";

const BASE_OPTIONS = {
	ide: "VS Code",
	workspaceRoot: "/workspace/project",
	workspaceName: "project",
	platform: "linux",
};

describe("processWorkspaceInfo", () => {
	it("redacts URL credentials while preserving SCP-style SSH remotes", () => {
		const metadata = JSON.parse(
			processWorkspaceInfo({
				rootPath: "/workspace/project",
				associatedRemoteUrls: [
					"origin: https://user:token@github.com/cline/cline.git",
					"backup: ssh://git:secret@example.com/cline/cline.git",
					"mirror: git@github.com:cline/cline.git",
				],
			}),
		);

		expect(
			metadata.workspaces["/workspace/project"].associatedRemoteUrls,
		).toEqual([
			"origin: https://github.com/cline/cline.git",
			"backup: ssh://example.com/cline/cline.git",
			"mirror: git@github.com:cline/cline.git",
		]);
	});
});

describe("buildClineSystemPrompt mode instructions", () => {
	it("keeps the system prompt byte-identical across plan/act switches", () => {
		// Core invariant for LLM-server KV/prompt caching: toggling Plan<->Act
		// must not change the serialized system prompt at all.
		expect(buildClineSystemPrompt({ ...BASE_OPTIONS, mode: "plan" })).toBe(
			buildClineSystemPrompt({ ...BASE_OPTIONS, mode: "act" }),
		);
		// Same invariant for hosts without the switch tool.
		expect(
			buildClineSystemPrompt({
				...BASE_OPTIONS,
				mode: "plan",
				planModeSwitchTool: false,
			}),
		).toBe(
			buildClineSystemPrompt({
				...BASE_OPTIONS,
				mode: "act",
				planModeSwitchTool: false,
			}),
		);
	});

	it("uses the caller-provided currentDate instead of the live clock", () => {
		const frozen = "01/01/2026";
		expect(
			buildClineSystemPrompt({ ...BASE_OPTIONS, currentDate: frozen }),
		).toContain(frozen);
		// Two builds with the same frozen date stay byte-identical even if the
		// real clock crosses midnight between them (night work across 00:00).
		expect(
			buildClineSystemPrompt({
				...BASE_OPTIONS,
				mode: "plan",
				currentDate: frozen,
			}),
		).toBe(
			buildClineSystemPrompt({
				...BASE_OPTIONS,
				mode: "act",
				currentDate: frozen,
			}),
		);
	});

	it("explains the user_input mode attribute in both modes", () => {
		for (const mode of ["act", "plan"] as const) {
			const prompt = buildClineSystemPrompt({ ...BASE_OPTIONS, mode });
			expect(prompt).toContain(MODE_TAG_INSTRUCTIONS);
			expect(prompt).toContain('<user_input mode="...">');
			expect(prompt).toContain("<mode_notice>");
		}
	});

	it("includes the static mode contracts in both modes", () => {
		for (const mode of ["act", "plan"] as const) {
			const prompt = buildClineSystemPrompt({ ...BASE_OPTIONS, mode });
			expect(prompt).toContain("# Plan / Act Mode Contracts");
		}
		// The mode-tag explanation precedes the contracts, matching the order
		// the CLI historically composed by hand.
		const prompt = buildClineSystemPrompt({ ...BASE_OPTIONS, mode: "plan" });
		expect(prompt.indexOf(MODE_TAG_INSTRUCTIONS)).toBeLessThan(
			prompt.indexOf("# Plan / Act Mode Contracts"),
		);
	});

	it("keeps run_commands available-but-read-only in the plan contract", () => {
		// Explicit product decision: run_commands is NOT removed in plan mode
		// (it is essential for read-only investigation); the mitigation for
		// plan-mode mutations is prompting plus the hard command guard, so the
		// contract must spell out the inspection-only usage.
		expect(MODE_CONTRACTS).toContain("run_commands");
		expect(MODE_CONTRACTS).toContain("read-only");
		expect(MODE_CONTRACTS).toContain("switch_to_act_mode");
	});

	it("swaps in the manual-switch contract when the host has no switch tool", () => {
		const prompt = buildClineSystemPrompt({
			...BASE_OPTIONS,
			mode: "plan",
			planModeSwitchTool: false,
		});
		expect(prompt).toContain(MODE_CONTRACTS_MANUAL_SWITCH);
		expect(prompt).not.toContain("switch_to_act_mode");
		// The read-only run_commands contract is shared by both variants.
		expect(MODE_CONTRACTS_MANUAL_SWITCH).toContain("run_commands");
		expect(MODE_CONTRACTS_MANUAL_SWITCH).toContain("Plan/Act toggle");
	});

	it("explains mode tags when the mode defaults to act", () => {
		expect(buildClineSystemPrompt({ ...BASE_OPTIONS })).toContain(
			MODE_TAG_INSTRUCTIONS,
		);
	});

	it("omits plan/act instructions in YOLO while preserving caller rules", () => {
		const rules = "# Custom Rules\n\nAlways speak like a pirate.";
		const prompt = buildClineSystemPrompt({
			...BASE_OPTIONS,
			mode: "yolo",
			rules,
		});
		expect(prompt).toContain(rules);
		expect(prompt).not.toContain(MODE_TAG_INSTRUCTIONS);
		expect(prompt).not.toContain(MODE_CONTRACTS);
		expect(prompt).not.toContain(MODE_CONTRACTS_MANUAL_SWITCH);
		expect(prompt).not.toContain("# Plan / Act Mode Contracts");
		expect(prompt).not.toContain("switch_to_act_mode");
	});

	it("places caller rules before the mode instructions", () => {
		const prompt = buildClineSystemPrompt({
			...BASE_OPTIONS,
			mode: "plan",
			rules: "# Custom Rules\n\nAlways speak like a pirate.",
		});
		const rulesIndex = prompt.indexOf("Always speak like a pirate.");
		expect(rulesIndex).toBeGreaterThan(-1);
		expect(rulesIndex).toBeLessThan(prompt.indexOf(MODE_TAG_INSTRUCTIONS));
	});

	it("includes rich workspace metadata for the Cline backend parser", () => {
		const metadata = JSON.stringify({
			workspaces: {
				"/workspace/project": {
					hint: "project",
					associatedRemoteUrls: ["origin: https://github.com/cline/cline.git"],
					latestGitCommitHash: "abc123",
				},
			},
		});
		const prompt = buildClineSystemPrompt({
			...BASE_OPTIONS,
			providerId: "cline",
			metadata,
		});

		expect(prompt).toContain(`# Workspace Configuration\n${metadata}`);
	});

	it("respects an explicit override prompt without injecting mode sections", () => {
		const prompt = buildClineSystemPrompt({
			...BASE_OPTIONS,
			mode: "plan",
			overridePrompt: "You are a custom agent.",
		});
		expect(prompt).toBe("You are a custom agent.");
	});
});
