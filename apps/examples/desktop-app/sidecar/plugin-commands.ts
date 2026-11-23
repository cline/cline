import {
	createHubPluginCommandsApi,
	type PluginCommandResult,
	parsePluginCommand,
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
	const commands = createHubPluginCommandsApi(
		getSessionRuntimeBinding(ctx, input.sessionId, input.environmentId)
			.hubClient,
	);
	const target = {
		workspacePath: sessionWorkspacePath(
			ctx,
			input.sessionId,
			input.workspacePath,
		),
		sessionId: input.sessionId,
	};
	// A failed catalog read must not block skills and workflows sharing the
	// slash syntax. Only a listed plugin command may fail the send.
	try {
		const name = parsePluginCommand(input.prompt)?.name;
		const catalog = await commands.list(target);
		if (!catalog.commands.some((command) => command.name === name))
			return undefined;
	} catch (error) {
		ctx.logger?.log("Plugin command discovery failed", {
			error,
			severity: "warn",
		});
		return undefined;
	}
	return commands.run({ ...target, prompt: input.prompt });
}
