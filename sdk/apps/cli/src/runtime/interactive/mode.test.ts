import { createTool } from "@clinebot/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../../utils/types";
import { resolveSystemPrompt } from "../prompt";
import { applyInteractiveModeConfig } from "./mode";

vi.mock("../prompt", () => ({
	resolveSystemPrompt: vi.fn(async (input: { mode?: string }) => {
		return `system prompt for ${input.mode ?? "unknown"}`;
	}),
}));

function makeConfig(): Config {
	return {
		apiKey: "",
		providerId: "cline",
		modelId: "openai/gpt-5.3-codex",
		verbose: false,
		sandbox: false,
		thinking: false,
		outputMode: "text",
		mode: "act",
		systemPrompt: "",
		enableTools: true,
		enableSpawnAgent: true,
		enableAgentTeams: true,
		defaultToolAutoApprove: false,
		toolPolicies: {},
		cwd: process.cwd(),
	};
}

const switchToActModeTool = createTool({
	name: "switch_to_act_mode",
	description: "Switch to act mode",
	inputSchema: {
		type: "object",
		properties: {},
	},
	execute: async () => "ok",
});

describe("applyInteractiveModeConfig", () => {
	beforeEach(() => {
		vi.mocked(resolveSystemPrompt).mockClear();
	});

	it("adds the mode switch tool when entering plan mode", async () => {
		const config = makeConfig();

		await applyInteractiveModeConfig({
			config,
			mode: "plan",
			switchToActModeTool,
		});

		expect(config.mode).toBe("plan");
		expect(config.extraTools).toEqual([switchToActModeTool]);
		expect(config.systemPrompt).toBe("system prompt for plan");
		expect(resolveSystemPrompt).toHaveBeenCalledWith({
			cwd: config.cwd,
			providerId: config.providerId,
			mode: "plan",
		});
	});

	it("removes the mode switch tool when entering act mode", async () => {
		const config = makeConfig();
		config.extraTools = [switchToActModeTool];

		await applyInteractiveModeConfig({
			config,
			mode: "act",
			switchToActModeTool,
		});

		expect(config.mode).toBe("act");
		expect(config.extraTools).toEqual([]);
		expect(config.systemPrompt).toBe("system prompt for act");
	});
});
