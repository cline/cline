import { createTool } from "@cline/shared";
import type { Config } from "../../utils/types";
import { resolveSystemPrompt } from "../prompt";

type InteractiveUiMode = "plan" | "act";

export function createInteractiveModeSwitchTool(input: {
	config: Config;
	pendingModeChange: { current: InteractiveUiMode | null };
	tuiModeChanged: { current: ((mode: InteractiveUiMode) => void) | null };
}) {
	return createTool({
		name: "switch_to_act_mode",
		description:
			"Switch from plan mode to act mode. Call this after the user has confirmed they want to proceed with the plan. Do not call this proactively or before the user has agreed.",
		inputSchema: {
			type: "object",
			properties: {},
		},
		timeoutMs: 5000,
		retryable: false,
		maxRetries: 0,
		execute: async () => {
			if (input.config.mode === "act") {
				return "Already in act mode.";
			}
			input.pendingModeChange.current = "act";
			input.tuiModeChanged.current?.("act");
			return "You successfully switched to act mode, proceed with the plan. You now have access to editing files and running commands. (The switch_to_act_mode tool is only available in plan mode.)";
		},
	});
}

export async function applyInteractiveModeConfig(input: {
	config: Config;
	mode: InteractiveUiMode;
	switchToActModeTool: NonNullable<Config["extraTools"]>[number];
}): Promise<void> {
	input.config.mode = input.mode;
	input.config.extraTools =
		input.mode === "plan" ? [input.switchToActModeTool] : [];
	input.config.systemPrompt = await resolveSystemPrompt({
		cwd: input.config.cwd,
		providerId: input.config.providerId,
		mode: input.mode,
	});
}
