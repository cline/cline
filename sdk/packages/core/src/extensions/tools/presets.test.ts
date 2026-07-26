import { describe, expect, it } from "vitest";
import {
	createDefaultToolsWithPreset,
	resolveToolPresetName,
	ToolPresets,
} from "./presets";

describe("default tool presets", () => {
	it("keeps mutation tools in act mode and removes them from plan mode", () => {
		expect(ToolPresets.act.enableBash).toBe(true);
		expect(ToolPresets.act.enableEditor).toBe(true);
		expect(ToolPresets.act.enableSpawnAgent).toBe(true);
		expect(ToolPresets.plan.enableBash).toBe(false);
		expect(ToolPresets.plan.enableEditor).toBe(false);
		expect(ToolPresets.plan.enableSpawnAgent).toBe(false);
		expect(ToolPresets.plan.enableAgentTeams).toBe(false);
	});

	it("resolves only act and plan presets from agent mode", () => {
		expect(resolveToolPresetName({ mode: "act" })).toBe("act");
		expect(resolveToolPresetName({ mode: "plan" })).toBe("plan");
		expect(resolveToolPresetName({})).toBe("act");
	});

	it("omits mutation tools from the concrete plan tool set", () => {
		const tools = createDefaultToolsWithPreset("plan", {
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

		expect(tools.map((tool) => tool.name)).not.toContain("run_commands");
		expect(tools.map((tool) => tool.name)).not.toContain("editor");
		expect(tools.map((tool) => tool.name)).toContain("read_files");
	});
});
