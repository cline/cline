import type { InteractiveTurnResult } from "../../tui/types";
import type { ChatCommandHost } from "../../utils/chat-commands";
import {
	type ChatCommandState,
	maybeHandleChatCommand,
} from "../../utils/chat-commands";
import {
	enableTeamsForPrompt,
	rewriteTeamPrompt,
	TEAM_COMMAND_USAGE,
} from "../../utils/team-command";
import type { Config } from "../../utils/types";
import type { createInteractiveSessionRuntime } from "./session-runtime";

type AutoApproveRef = {
	current: boolean;
};

export type InteractiveChatCommandRuntime = Pick<
	ReturnType<typeof createInteractiveSessionRuntime>,
	"forkCurrentSession" | "getActiveSessionId" | "restartEmpty"
>;

export type InteractiveChatCommandResult =
	| { handled: true; turnResult: InteractiveTurnResult }
	| { handled: false; input: string };

function commandTurnResult(commandOutput?: string): InteractiveTurnResult {
	return {
		usage: { inputTokens: 0, outputTokens: 0 },
		iterations: 0,
		commandOutput,
	};
}

export async function runInteractiveChatCommand(input: {
	prompt: string;
	enabled: boolean;
	config: Config;
	host: ChatCommandHost;
	chatCommandState: ChatCommandState;
	autoApproveAllRef: AutoApproveRef;
	setInteractiveAutoApprove: (enabled: boolean) => void;
	sessionRuntime: InteractiveChatCommandRuntime;
	stop: () => void;
}): Promise<InteractiveChatCommandResult> {
	let prompt = input.prompt;
	const rewrittenTeamPrompt = rewriteTeamPrompt(prompt);
	if (rewrittenTeamPrompt.kind !== "none") {
		if (rewrittenTeamPrompt.kind === "usage") {
			return {
				handled: true,
				turnResult: commandTurnResult(TEAM_COMMAND_USAGE),
			};
		}
		if (!input.config.enableAgentTeams) {
			await enableTeamsForPrompt(input.config);
			await input.sessionRuntime.restartEmpty();
		}
		prompt = rewrittenTeamPrompt.prompt;
	}

	let commandOutput: string | undefined;
	const handled = await maybeHandleChatCommand(prompt, {
		enabled: input.enabled,
		host: input.host,
		getState: () => ({
			...input.chatCommandState,
			autoApproveTools: input.autoApproveAllRef.current,
		}),
		setState: async (next) => {
			input.chatCommandState.enableTools = next.enableTools;
			input.chatCommandState.autoApproveTools = next.autoApproveTools;
			input.chatCommandState.cwd = next.cwd;
			input.chatCommandState.workspaceRoot = next.workspaceRoot;
			input.setInteractiveAutoApprove(next.autoApproveTools);
		},
		reply: async (text) => {
			commandOutput = text;
		},
		reset: async () => {
			await input.sessionRuntime.restartEmpty();
		},
		stop: async () => {
			input.stop();
		},
		describe: () =>
			[
				`sessionId=${input.sessionRuntime.getActiveSessionId()}`,
				`tools=${input.chatCommandState.enableTools ? "on" : "off"}`,
				`yolo=${input.autoApproveAllRef.current ? "on" : "off"}`,
				`cwd=${input.chatCommandState.cwd}`,
				`workspaceRoot=${input.chatCommandState.workspaceRoot}`,
			].join("\n"),
		fork: input.sessionRuntime.forkCurrentSession,
	});
	if (handled) {
		return {
			handled: true,
			turnResult: commandTurnResult(commandOutput),
		};
	}
	return { handled: false, input: prompt };
}
