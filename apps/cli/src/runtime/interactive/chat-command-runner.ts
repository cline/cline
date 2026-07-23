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
	| "forkCurrentSession"
	| "getActiveSessionId"
	| "resetForNewSession"
	| "restartEmpty"
	| "changeWorkingDirectory"
>;

export type InteractiveChatCommandResult =
	| { handled: true; turnResult: InteractiveTurnResult }
	| { handled: false; input: string; commandOutput?: string };

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
	onCommandOutput?: (text: string) => void;
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
	let submitPrompt: string | undefined;
	const handled = await maybeHandleChatCommand(prompt, {
		enabled: input.enabled,
		host: input.host,
		getState: () => ({
			...input.chatCommandState,
			autoApproveTools: input.autoApproveAllRef.current,
		}),
		setState: async (next) => {
			if (
				next.cwd !== input.chatCommandState.cwd ||
				next.workspaceRoot !== input.chatCommandState.workspaceRoot
			) {
				await input.sessionRuntime.changeWorkingDirectory(next);
			} else {
				Object.assign(input.chatCommandState, next);
			}
			input.setInteractiveAutoApprove(next.autoApproveTools);
		},
		reply: async (text) => {
			commandOutput = text;
			input.onCommandOutput?.(text);
		},
		submitPrompt: async (text) => {
			const trimmed = text.trim();
			if (trimmed) {
				submitPrompt = trimmed;
			}
		},
		reset: async () => {
			await input.sessionRuntime.resetForNewSession();
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
		if (submitPrompt) {
			return {
				handled: false,
				input: submitPrompt,
				...(commandOutput ? { commandOutput } : {}),
			};
		}
		return {
			handled: true,
			turnResult: commandTurnResult(commandOutput),
		};
	}
	return { handled: false, input: prompt };
}
