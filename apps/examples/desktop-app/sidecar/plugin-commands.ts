import {
	createPluginCommandService,
	type PluginCommandResult,
	type PluginCommandService,
} from "@cline/core";
import type { SidecarContext } from "./types";

// One service per workspace; it keeps the plugin sandboxes alive between
// commands and reloads them itself when the plugin set changes.
const servicesByWorkspace = new Map<string, PluginCommandService>();

export function getPluginCommandService(
	ctx: SidecarContext,
	workspacePath: string,
): PluginCommandService {
	let service = servicesByWorkspace.get(workspacePath);
	if (!service) {
		service = createPluginCommandService({
			cwd: workspacePath,
			workspacePath,
			logger: ctx.logger,
		});
		servicesByWorkspace.set(workspacePath, service);
	}
	return service;
}

// Workspaces already warmed; the webview re-reports its active workspace
// every few seconds, and the service reloads itself on plugin changes.
const warmedWorkspaces = new Set<string>();

/**
 * Spawn the plugin sandbox for a workspace ahead of the first slash menu
 * open (the CLI does the same at TUI mount), so the menu lists plugin
 * commands immediately instead of paying the cold spawn on the first `/`.
 * Called whenever the webview reports its active workspace, which is the
 * path the slash menu and handleSend will later use.
 */
export function warmPluginCommandService(
	ctx: SidecarContext,
	workspacePath: string,
): void {
	if (warmedWorkspaces.has(workspacePath)) return;
	warmedWorkspaces.add(workspacePath);
	void getPluginCommandService(ctx, workspacePath)
		.listCommands()
		.catch((error) => {
			// Load failures are already logged by the service; anything else
			// here must not take the sidecar down.
			ctx.logger?.debug?.("plugin command warmup failed", { error });
		});
}

/**
 * Run a plugin-registered slash command for the leading `/name` token of a
 * prompt. Returns undefined when no enabled plugin declares the command so
 * the prompt continues through the normal path.
 */
export async function runPluginSlashCommand(
	ctx: SidecarContext,
	input: { workspacePath: string; prompt: string },
): Promise<PluginCommandResult | undefined> {
	const match = input.prompt.match(/^\/(\S+)([\s\S]*)$/);
	if (!match?.[1]) return undefined;
	return await getPluginCommandService(ctx, input.workspacePath).run(
		match[1],
		match[2] ?? "",
	);
}
