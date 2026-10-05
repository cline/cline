import {
	createHubPluginCommandsApi,
	type PluginCommandResult,
	type PluginCommandTarget,
	parsePluginCommand,
} from "@cline/core";
import { getSessionRuntimeBinding } from "./context";
import type { SidecarContext } from "./types";

export async function listPluginCommands(
	ctx: SidecarContext,
	workspacePath: string,
	sessionId?: string,
	environmentId?: string,
	selection?: Pick<PluginCommandTarget, "providerId" | "modelId" | "pluginPaths" | "cwd">,
) {
	const client = getSessionRuntimeBinding(
		ctx,
		sessionId,
		environmentId,
	).hubClient;
	return createHubPluginCommandsApi(client).list({ ...selection, workspacePath, sessionId });
}

export async function runPluginSlashCommand(
	ctx: SidecarContext,
	input: PluginCommandTarget & {
		prompt: string;
		sessionId: string;
		environmentId?: string;
	},
): Promise<PluginCommandResult | undefined> {
	const commands = createHubPluginCommandsApi(
		getSessionRuntimeBinding(ctx, input.sessionId, input.environmentId)
			.hubClient,
	);
	const parsed = parsePluginCommand(input.prompt);
	if (!parsed) return undefined;
	// A discovery failure must not prevent independent instruction expansion.
	let catalog;
	try { catalog = await commands.list(input); }
	catch (error) {
		ctx.logger?.debug("Plugin command discovery unavailable", { error });
		return undefined;
	}
	if (!catalog.commands.some((command) => command.name === parsed.name)) return undefined;
	return commands.run(input);
}
