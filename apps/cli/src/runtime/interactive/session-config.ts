import type { TeamEvent } from "@cline/core";
import type { ChatCommandState } from "../../utils/chat-commands";
import type { Config } from "../../utils/types";
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
	};
}
