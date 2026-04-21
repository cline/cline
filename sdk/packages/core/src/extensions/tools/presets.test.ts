import { describe, expect, it } from "vitest";
import {
	createDefaultToolsWithPreset,
	createToolPoliciesWithPreset,
	ToolPresets,
} from "./presets";

describe("default tool presets", () => {
	it("explicitly configures ask_question across presets", () => {
		expect(ToolPresets.search.enableAskQuestion).toBe(false);
		expect(ToolPresets.development.enableAskQuestion).toBe(true);
		expect(ToolPresets.readonly.enableAskQuestion).toBe(true);
		expect(ToolPresets.minimal.enableAskQuestion).toBe(true);
		expect(ToolPresets.yolo.enableAskQuestion).toBe(false);
	});

	it("disables spawn and team tools by default in yolo mode", () => {
		expect(ToolPresets.development.enableSpawnAgent).toBe(true);
		expect(ToolPresets.development.enableAgentTeams).toBe(true);
		expect(ToolPresets.yolo.enableSpawnAgent).toBe(false);
		expect(ToolPresets.yolo.enableAgentTeams).toBe(false);
		expect(ToolPresets.yolo.enableSubmitAndExit).toBe(true);
	});

	it("yolo preset excludes ask_question even when its executor exists", () => {
		const tools = createDefaultToolsWithPreset("yolo", {
			executors: {
				readFile: async () => "ok",
				search: async () => "ok",
				bash: async () => "ok",
				webFetch: async () => "ok",
				applyPatch: async () => "ok",
				editor: async () => "ok",
				skills: async () => "ok",
				askQuestion: async () => "ok",
			},
		});

		expect(tools.map((tool) => tool.name)).toEqual([
			"read_files",
			"search_codebase",
			"run_commands",
			"fetch_web_content",
			"editor",
			"skills",
		]);
	});
});

describe("tool policy presets", () => {
	it("returns empty policies for default", () => {
		expect(createToolPoliciesWithPreset("default")).toEqual({});
	});

	it("yolo preset enables and auto-approves all tools", () => {
		const policies = createToolPoliciesWithPreset("yolo");
		expect(policies["*"]).toEqual({
			enabled: true,
			autoApprove: true,
		});
		expect(policies.ask_question).toEqual({
			enabled: true,
			autoApprove: true,
		});
		expect(policies.skills).toEqual({
			enabled: true,
			autoApprove: true,
		});
	});
});
