import {
	createHubPluginCommandsApi,
	type PluginCommandResult,
} from "@cline/core";
import { getSessionRuntimeBinding } from "./context";
import type { SidecarContext } from "./types";

/**
 * The runtime rejects a session command whose workspace differs from the
 * session's `workspaceRoot ?? cwd`, so target the live session the same way.
 */
function sessionWorkspacePath(
	ctx: SidecarContext,
	sessionId: string | undefined,
	fallback: string,
): string {
	const config = sessionId
		? ctx.liveSessions.get(sessionId)?.config
		: undefined;
	for (const value of [config?.workspaceRoot, config?.cwd]) {
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	return fallback;
}

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
	return createHubPluginCommandsApi(client).list({
		workspacePath: sessionWorkspacePath(ctx, sessionId, workspacePath),
		sessionId,
	});
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
	).run({
		workspacePath: sessionWorkspacePath(
			ctx,
			input.sessionId,
			input.workspacePath,
		),
		sessionId: input.sessionId,
		prompt: input.prompt,
	});
}
