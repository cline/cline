import type {
	PluginCommandResult,
	PluginSlashCommand,
} from "../../services/plugin-commands";
import type { PluginInstallResult } from "../../services/plugin-install";
import type { NodeHubClient } from "./index";

/** Client-only access to the Hub's plugin execution and installation. */
export class HubPluginClient {
	constructor(private readonly client: Pick<NodeHubClient, "command">) {}

	async listCommands(workspaceRoot: string): Promise<PluginSlashCommand[]> {
		const reply = await this.client.command(
			"plugins.commands.list",
			{
				workspaceRoot,
			},
			undefined,
			{ timeoutMs: null },
		);
		if (!reply.ok)
			throw new Error(
				reply.error?.message ?? "Plugin command discovery failed",
			);
		return reply.payload?.commands as PluginSlashCommand[];
	}

	async runCommand(
		workspaceRoot: string,
		name: string,
		input: string,
	): Promise<PluginCommandResult | undefined> {
		// The plugin runtime bounds loading and execution. A transport deadline
		// must not abandon a valid handler while it is still running.
		const reply = await this.client.command(
			"plugins.commands.run",
			{
				workspaceRoot,
				name,
				input,
			},
			undefined,
			{ timeoutMs: null },
		);
		if (!reply.ok)
			throw new Error(
				reply.error?.message ?? "Plugin command execution failed",
			);
		return reply.payload?.handled
			? (reply.payload.result as PluginCommandResult)
			: undefined;
	}

	async install(input: {
		source: string;
		force?: boolean;
	}): Promise<PluginInstallResult> {
		const reply = await this.client.command(
			"plugins.install",
			input,
			undefined,
			{ timeoutMs: 600_000 },
		);
		if (!reply.ok)
			throw new Error(reply.error?.message ?? "Plugin installation failed");
		return reply.payload?.result as PluginInstallResult;
	}
}
