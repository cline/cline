import type { BasicLogger, PluginCommandsApi, PluginCommandTarget } from "@cline/core";
import { chatCommandHost } from "./chat-commands";

export async function createWorkspaceChatCommandHost(input: {
	cwd: string;
	workspaceRoot?: string;
	logger?: BasicLogger;
	commands: PluginCommandsApi;
	selection?: Pick<PluginCommandTarget, "providerId" | "modelId" | "pluginPaths">;
	getTarget?: () => PluginCommandTarget;
}) {
	const commands = input.commands;
	const target = () => input.getTarget?.() ?? ({ ...input.selection, workspacePath: input.workspaceRoot?.trim() || input.cwd });
	const host = chatCommandHost.clone().setFallback(async (parsed, context) => {
		const current = target();
		const result = await commands.run({
			...current,
			workspacePath: parsed.state.workspaceRoot || parsed.state.cwd,
			cwd: parsed.state.cwd,
			sessionId: input.getTarget ? current.sessionId : parsed.state.sessionId,
			prompt: `${parsed.command}${parsed.argumentsText}`,
		});
		if (!result) return false;
		if (result.reply) await context.reply(result.reply);
		if (result.submitPrompt) await context.submitPrompt?.(result.submitPrompt);
		return true;
	});
	return {
		host,
		async listCommands() {
			const catalog = await commands.list(target());
			if (catalog.status === "error")
				input.logger?.log(`Plugin commands unavailable: ${catalog.error}`);
			return catalog.commands;
		},
		subscribe(listener: () => void) {
			return commands.subscribe((catalog) => {
				if (catalog.workspacePath === target().workspacePath) listener();
			});
		},
	};
}
