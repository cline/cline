import {
	createHubPluginCommandsApi,
	type PluginCommandResult,
} from "@cline/core";
import { getSessionRuntimeBinding } from "./context";
import type { SidecarContext } from "./types";

export async function listPluginCommands(
	ctx: SidecarContext,
	workspacePath: string,
	sessionId?: string,
	environmentId?: string,
) {
	const client = getSessionRuntimeBinding(
		ctx,
		sessionId,
		environmentId,
	).hubClient;
	return createHubPluginCommandsApi(client).list({ workspacePath, sessionId });
}

export async function runPluginSlashCommand(
	ctx: SidecarContext,
	input: {
		workspacePath: string;
		prompt: string;
		sessionId: string;
		environmentId?: string;
	},
): Promise<PluginCommandResult | undefined> {
	return createHubPluginCommandsApi(
		getSessionRuntimeBinding(ctx, input.sessionId, input.environmentId)
			.hubClient,
	).run(input);
}
