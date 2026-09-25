import type { BasicLogger, PluginCommandsApi } from "@cline/core";
import { chatCommandHost } from "./chat-commands";

export async function createWorkspaceChatCommandHost(input: {
	cwd: string;
	workspaceRoot?: string;
	logger?: BasicLogger;
	commands: PluginCommandsApi;
	getSessionId?: () => string | undefined;
}) {
	const commands = input.commands;
	const target = () => ({
		workspacePath: input.workspaceRoot?.trim() || input.cwd,
		sessionId: input.getSessionId?.() || undefined,
	});
	const host = chatCommandHost.clone().setFallback(async (parsed, context) => {
		const result = await commands.run({
			...target(),
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
