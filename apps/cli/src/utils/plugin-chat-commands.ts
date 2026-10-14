import {
	type BasicLogger,
	createPluginCommandService,
	type PluginSlashCommand,
} from "@cline/core";
import { type ChatCommandHost, chatCommandHost } from "./chat-commands";

export type { PluginSlashCommand };

export interface WorkspaceChatCommandHostResult {
	host: ChatCommandHost;
	// Plugin-registered commands surfaced as slash commands for TUI autocomplete.
	pluginSlashCommands: PluginSlashCommand[];
	shutdown?: () => Promise<void>;
}

export async function createWorkspaceChatCommandHost(input: {
	cwd: string;
	workspaceRoot?: string;
	logger?: BasicLogger;
}): Promise<WorkspaceChatCommandHostResult> {
	const service = createPluginCommandService({
		cwd: input.cwd,
		workspacePath: input.workspaceRoot?.trim() || input.cwd,
		logger: input.logger,
	});
	// Load failures are logged by the service and yield no commands.
	const pluginSlashCommands = await service.listCommands();
	if (pluginSlashCommands.length === 0) {
		await service.shutdown();
		return { host: chatCommandHost, pluginSlashCommands: [] };
	}

	const host = chatCommandHost.clone();
	for (const command of pluginSlashCommands) {
		host.register("command", {
			names: [`/${command.name}`],
			run: async ({ args }, context) => {
				const result = await service.run(command.name, args.join(" "));
				if (result?.reply) {
					await context.reply(result.reply);
				}
				if (result?.submitPrompt) {
					await context.submitPrompt?.(result.submitPrompt);
				}
			},
		});
	}
	return { host, pluginSlashCommands, shutdown: service.shutdown };
}
