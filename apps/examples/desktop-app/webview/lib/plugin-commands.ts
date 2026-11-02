import { hubPlugins } from "./hub-client";
import type { PluginCommandTarget } from "@cline/core";

/** Only listed plugin commands intercept sends; discovery failure leaves skills/workflows usable. */
export async function runPluginSlashCommand(
	environmentId: string,
	input: PluginCommandTarget & { prompt: string },
	signal?: AbortSignal,
) {
	signal?.throwIfAborted();
	const match = input.prompt.trimStart().match(/^\/(\S+)/);
	const name = match?.[1].replace(/^\/+/, "").toLowerCase();
	if (!name || ["compact", "fork", "team"].includes(name)) return undefined;
	const plugins = hubPlugins(environmentId);
	const catalog = await plugins
		.list({ workspacePath: input.workspacePath, sessionId: input.sessionId })
		.catch(() => undefined);
	signal?.throwIfAborted();
	if (!catalog?.commands.some((command) => command.name === name))
		return undefined;
	const result = await plugins.run(input);
	signal?.throwIfAborted();
	return result;
}
