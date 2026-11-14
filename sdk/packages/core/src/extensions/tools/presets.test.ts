import { describe, expect, it } from "vitest";
import {
	createDefaultToolsWithPreset,
	createToolPoliciesWithPreset,
	ToolPresets,
} from "./presets";

describe("default tool presets", () => {
	it("explicitly configures ask_question across presets", () => {
		expect(ToolPresets.search.enableAskQuestion).toBe(false);
		expect(ToolPresets.act.enableAskQuestion).toBe(true);
		expect(ToolPresets.plan.enableAskQuestion).toBe(true);
		expect(ToolPresets.minimal.enableAskQuestion).toBe(false);
		expect(ToolPresets.yolo.enableAskQuestion).toBe(false);
	});

	it("disables spawn and team tools by default in yolo mode", () => {
		expect(ToolPresets.act.enableSpawnAgent).toBe(true);
		expect(ToolPresets.act.enableAgentTeams).toBe(true);
		expect(ToolPresets.yolo.enableSpawnAgent).toBe(false);
		expect(ToolPresets.yolo.enableAgentTeams).toBe(false);
		expect(ToolPresets.yolo.enableSubmitAndExit).toBe(true);
	});

	it("disables search and web fetch in yolo mode", () => {
		expect(ToolPresets.yolo.enableSearch).toBe(false);
		expect(ToolPresets.yolo.enableWebFetch).toBe(false);
	});

	it("keeps shell access and a stable tool set in plan mode", () => {
		// Plan mode keeps run_commands for read-only investigation; the
		// plan-mode command-guard hook registered by the runtime builder is
		// the hard backstop behind the prompt contract. The editor stays
		// enabled so the serialized tool set is byte-identical between plan
		// and act (stable LLM prompt prefix across mode switches); the
		// plan-mode editor-guard hook blocks its calls before execution.
		expect(ToolPresets.plan.enableBash).toBe(true);
		expect(ToolPresets.plan.enableEditor).toBe(true);
		// Plan and act expose exactly the same flags.
		const actFlags = ToolPresets.act as Record<string, boolean>;
		const planFlags = ToolPresets.plan as Record<string, boolean>;
		for (const [key, value] of Object.entries(actFlags)) {
			if (key === "enableSpawnAgent" || key === "enableAgentTeams") {
				continue;
			}
			expect(planFlags[key]).toBe(value);
		}
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
			"run_commands",
			"editor",
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
