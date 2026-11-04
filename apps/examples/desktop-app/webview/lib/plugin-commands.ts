import { hubPlugins } from "./hub-client";
import type { PluginCommandTarget } from "@cline/core";

/** Stop waiting locally without replaying or cancelling a dispatched Hub mutation. */
async function waitForPlugin<T>(
	operation: () => Promise<T>,
	signal?: AbortSignal,
): Promise<T> {
	signal?.throwIfAborted();
	if (!signal) return operation();
	let abort!: () => void;
	try {
		return await new Promise<T>((resolve, reject) => {
			abort = () => reject(signal.reason);
			signal.addEventListener("abort", abort, { once: true });
			// Keep rejection handlers attached even if the viewer stops waiting first.
			operation().then(resolve, reject);
		});
	} finally {
		signal.removeEventListener("abort", abort);
	}
}

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
	const catalog = await waitForPlugin(
		() =>
			plugins
				.list({
					workspacePath: input.workspacePath,
					sessionId: input.sessionId,
				})
				.catch(() => undefined),
		signal,
	);
	signal?.throwIfAborted();
	if (!catalog?.commands.some((command) => command.name === name))
		return undefined;
	const result = await waitForPlugin(() => plugins.run(input), signal);
	signal?.throwIfAborted();
	return result;
}
