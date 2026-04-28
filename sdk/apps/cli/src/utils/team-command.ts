import { formatUserCommandBlock } from "@clinebot/shared";
import type { Config } from "./types";

export const TEAM_COMMAND_USAGE =
	"Usage: /team <task description>\nStarts a team of agents for the given task.";

type TeamPromptRewriteResult =
	| { kind: "none" }
	| { kind: "usage" }
	| { kind: "rewritten"; prompt: string };

export function rewriteTeamPrompt(input: string): TeamPromptRewriteResult {
	const match = /^\/team\b([\s\S]*)$/i.exec(input.trim());
	if (!match) {
		return { kind: "none" };
	}
	const taskBody = match[1].trim();
	if (!taskBody) {
		return { kind: "usage" };
	}
	return {
		kind: "rewritten",
		prompt: formatUserCommandBlock(
			`spawn a team of agents for the following task: ${taskBody}`,
			"team",
		),
	};
}

export async function enableTeamsForPrompt(config: Config): Promise<void> {
	if (config.enableAgentTeams) {
		return;
	}
	config.enableAgentTeams = true;
	config.teamName = config.teamName?.trim() || undefined;
}
