import type {
	PluginCommandCatalog,
	PluginCommandResult,
	PluginCommandsApi,
} from "../../services/plugin-command-api";
import type { NodeHubClient } from "./index";

/** Uses the caller's existing connection and subscription lifecycle. */
export function createHubPluginCommandsApi(
	client: Pick<NodeHubClient, "command" | "subscribe">,
): PluginCommandsApi {
	return {
		async list(target) {
			const reply = await client.command(
				"plugins.commands.list",
				{ ...target },
				target.sessionId,
			);
			return reply.payload?.catalog as unknown as PluginCommandCatalog;
		},
		async run(input) {
			const reply = await client.command(
				"plugins.commands.run",
				{ ...input },
				input.sessionId,
			);
			return reply.payload?.result as PluginCommandResult | undefined;
		},
		subscribe(listener) {
			return client.subscribe((event) => {
				if (event.event === "plugins.commands.changed")
					listener(event.payload?.catalog as unknown as PluginCommandCatalog);
			});
		},
	};
}
