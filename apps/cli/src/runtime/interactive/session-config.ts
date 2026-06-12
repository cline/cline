import type { TeamEvent } from "@cline/core";
import type { ChatCommandState } from "../../utils/chat-commands";
import type { Config } from "../../utils/types";
import { resolveAgentProfileDisabledPluginPaths } from "../agent-profile-plugins";
import { resolveAgentProfileDisabledToolNames } from "../agent-profile-tools";
import {
	CLI_DEFAULT_CHECKPOINT_CONFIG,
	CLI_DEFAULT_LOOP_DETECTION,
} from "../defaults";

export function buildInteractiveSessionConfig(input: {
	config: Config;
	chatCommandState: ChatCommandState;
	runtimeHooks: { hooks?: Config["hooks"] };
	onTeamEvent: (event: TeamEvent) => void;
	resolveMistakeLimitDecision: Config["onConsecutiveMistakeLimitReached"];
}): Config {
	return {
		...input.config,
		execution: {
			...input.config.execution,
			loopDetection:
				input.config.execution?.loopDetection ?? CLI_DEFAULT_LOOP_DETECTION,
		},
		checkpoint: input.config.checkpoint ?? CLI_DEFAULT_CHECKPOINT_CONFIG,
		enableTools: input.chatCommandState.enableTools,
		cwd: input.chatCommandState.cwd,
		workspaceRoot: input.chatCommandState.workspaceRoot,
		hooks: input.runtimeHooks.hooks,
		onTeamEvent: input.onTeamEvent,
		onConsecutiveMistakeLimitReached: input.resolveMistakeLimitDecision,
		// Recomputed on every session (re)start so switching profiles swaps the
		// plugin set and reverting to the default agent clears the restriction.
		disabledPluginPaths: resolveAgentProfileDisabledPluginPaths(
			input.config.agentProfile,
			input.chatCommandState.workspaceRoot,
		),
		// Same lifecycle for the profile's tools and skills restrictions. The
		// availability context tracks the live provider/model/mode so routed
		// tool names (editor vs apply_patch) stay accurate across /model and
		// plan/act switches. The skills allowlist scopes the agent's skills
		// tool only: a user explicitly typing a /skill slash command is an
		// explicit user action that wins over the profile, like /model.
		disabledToolNames: resolveAgentProfileDisabledToolNames(
			input.config.agentProfile,
			{
				mode: input.config.mode,
				providerId: input.config.providerId,
				modelId: input.config.modelId,
			},
		),
		skills: input.config.agentProfile?.skills,
	};
}
