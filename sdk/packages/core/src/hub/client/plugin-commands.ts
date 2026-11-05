import type { HubCommandEnvelope, HubReplyEnvelope } from "@cline/shared";
import type {
	PluginCommandCatalog,
	PluginCommandResult,
	PluginCommandsApi,
} from "../../services/plugin-command-api";
import { HubCommandError, type NodeHubClient } from "./index";

/**
 * A Hub that predates plugin command RPCs, kept alive while it has active
 * work, answers unsupported_command. Resolves undefined for that Hub.
 */
async function commandIfSupported(
	client: Pick<NodeHubClient, "command">,
	command: HubCommandEnvelope["command"],
	payload: Record<string, unknown>,
	sessionId: string | undefined,
	options: Parameters<NodeHubClient["command"]>[3],
): Promise<HubReplyEnvelope | undefined> {
	try {
		return await client.command(command, payload, sessionId, options);
	} catch (error) {
		if (
			error instanceof HubCommandError &&
			error.code === "unsupported_command"
		)
			return undefined;
		throw error;
	}
}

/** Uses the caller's existing connection. */
export function createHubPluginCommandsApi(
	client: Pick<NodeHubClient, "command">,
): PluginCommandsApi {
	return {
		async list(target) {
			const reply = await commandIfSupported(
				client,
				"plugins.commands.list",
				{ ...target },
				target.sessionId,
				{ timeoutMs: null },
			);
			if (!reply) return { ...target, status: "ready", commands: [] };
			if (!reply.ok)
				throw new Error(
					reply.error?.message ?? "Plugin command discovery failed",
				);
			return reply.payload?.catalog as unknown as PluginCommandCatalog;
		},
		async run(input) {
			const reply = await commandIfSupported(
				client,
				"plugins.commands.run",
				{ ...input },
				input.sessionId,
				{ timeoutMs: null, retryAfterDispatch: false },
			);
			if (!reply) return undefined;
			if (!reply.ok)
				throw new Error(
					reply.error?.message ?? "Plugin command execution failed",
				);
			return reply.payload?.result as PluginCommandResult | undefined;
		},
	};
}
