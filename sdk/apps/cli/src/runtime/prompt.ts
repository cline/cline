import { getClineDefaultSystemPrompt } from "@clinebot/agents";
import {
	buildWorkspaceMetadata,
	resolveRuntimeSlashCommandFromWatcher,
	type UserInstructionConfigWatcher,
} from "@clinebot/core";

const WORKSPACE_CONFIGURATION_MARKER = "# Workspace Configuration";

export async function resolveSystemPrompt(input: {
	cwd: string;
	explicitSystemPrompt?: string;
	providerId?: string;
	rules?: string;
}): Promise<string> {
	const shouldAppendWorkspaceMetadata = input.providerId === "cline";
	const workspace = shouldAppendWorkspaceMetadata
		? await buildWorkspaceMetadata(input.cwd)
		: "";
	const explicit = input.explicitSystemPrompt?.trim();
	if (explicit) {
		if (
			shouldAppendWorkspaceMetadata &&
			!explicit.includes(WORKSPACE_CONFIGURATION_MARKER)
		) {
			return `${explicit}\n\n${workspace}`;
		}
		return explicit;
	}
	return getClineDefaultSystemPrompt(
		"Terminal Shell",
		input.cwd,
		shouldAppendWorkspaceMetadata ? workspace : "",
		input.rules,
	);
}

export async function buildUserInputMessage(
	rawPrompt: string,
	userInstructionWatcher?: UserInstructionConfigWatcher,
): Promise<string> {
	return userInstructionWatcher
		? resolveRuntimeSlashCommandFromWatcher(rawPrompt, userInstructionWatcher)
		: rawPrompt;
}
