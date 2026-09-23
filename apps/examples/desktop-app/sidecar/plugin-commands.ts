import {
	createPluginCommandService,
	type PluginCommandResult,
	type PluginCommandService,
} from "@cline/core";

// One service per workspace; it keeps the plugin sandboxes alive between
// commands and reloads them itself when the plugin set changes.
const servicesByWorkspace = new Map<string, PluginCommandService>();

export function getPluginCommandService(
	workspacePath: string,
): PluginCommandService {
	let service = servicesByWorkspace.get(workspacePath);
	if (!service) {
		service = createPluginCommandService({ cwd: workspacePath, workspacePath });
		servicesByWorkspace.set(workspacePath, service);
	}
	return service;
}

/**
 * Run a plugin-registered slash command for the leading `/name` token of a
 * prompt. Returns undefined when no enabled plugin declares the command so
 * the prompt continues through the normal path.
 */
export async function runPluginSlashCommand(input: {
	workspacePath: string;
	prompt: string;
}): Promise<PluginCommandResult | undefined> {
	const match = input.prompt.match(/^\/(\S+)([\s\S]*)$/);
	if (!match?.[1]) return undefined;
	return await getPluginCommandService(input.workspacePath).run(
		match[1],
		match[2] ?? "",
	);
}
