import { basename } from "node:path";
import {
	buildWorkspaceMetadata,
	resolveRuntimeSlashCommandFromWatcher,
	type UserInstructionConfigWatcher,
} from "@clinebot/core";
import { buildClineSystemPrompt } from "@clinebot/shared";

export async function resolveSystemPrompt(input: {
	cwd: string;
	explicitSystemPrompt?: string;
	providerId?: string;
	rules?: string;
	mode?: "act" | "plan" | "yolo";
}): Promise<string> {
	const metadata = await buildWorkspaceMetadata(input.cwd);
	return buildClineSystemPrompt({
		ide: "Terminal Shell",
		workspaceRoot: input.cwd,
		workspaceName: basename(input.cwd),
		metadata,
		rules: input.rules,
		mode: input.mode,
		providerId: input.providerId,
		overridePrompt: input.explicitSystemPrompt,
		platform:
			(typeof process !== "undefined" && process?.platform) || "unknown",
	});
}

export async function buildUserInputMessage(
	rawPrompt: string,
	userInstructionWatcher?: UserInstructionConfigWatcher,
): Promise<string> {
	return userInstructionWatcher
		? resolveRuntimeSlashCommandFromWatcher(rawPrompt, userInstructionWatcher)
		: rawPrompt;
}
