import {
	type AgentExtensionCommand,
	createContributionRegistry,
} from "@clinebot/agents";
import { resolveAndLoadAgentPlugins } from "@clinebot/core";
import {
	type ChatCommandDefinition,
	type ChatCommandHost,
	chatCommandHost,
} from "./chat-commands";

function normalizeCommandName(name: string): string {
	const trimmed = name.trim();
	if (!trimmed) {
		return trimmed;
	}
	return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function createPluginCommandDefinition(
	command: AgentExtensionCommand,
): ChatCommandDefinition | undefined {
	if (typeof command.handler !== "function") {
		return undefined;
	}
	const normalizedName = normalizeCommandName(command.name);
	if (!normalizedName) {
		return undefined;
	}
	return {
		names: [normalizedName.toLowerCase()],
		run: async ({ args }, context) => {
			const result = await command.handler?.(args.join(" "));
			if (typeof result === "string" && result.trim()) {
				await context.reply(result);
			}
		},
	};
}

export async function createWorkspaceChatCommandHost(input: {
	cwd: string;
	workspaceRoot?: string;
}): Promise<ChatCommandHost> {
	const workspaceRoot = input.workspaceRoot?.trim() || input.cwd;
	const loaded = await resolveAndLoadAgentPlugins({
		cwd: input.cwd,
		workspacePath: workspaceRoot,
		mode: "in_process",
	});
	if (!loaded.extensions.length) {
		return chatCommandHost;
	}

	const registry = createContributionRegistry({
		extensions: loaded.extensions,
	});
	await registry.initialize();

	const host = chatCommandHost.clone();
	for (const command of registry.getRegistrySnapshot().commands) {
		const definition = createPluginCommandDefinition(command);
		if (definition) {
			host.register("command", definition);
		}
	}
	return host;
}
