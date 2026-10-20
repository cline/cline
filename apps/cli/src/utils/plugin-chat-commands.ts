import type {
	BasicLogger,
	PluginCommandCatalog,
	PluginCommandsApi,
} from "@cline/core";
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
		const commandTarget = {
			workspacePath: parsed.state.workspaceRoot || parsed.state.cwd,
			sessionId: parsed.state.sessionId ?? input.getSessionId?.(),
		};
		let catalog: PluginCommandCatalog;
		try {
			catalog = await commands.list(commandTarget);
		} catch (error) {
			input.logger?.log("Plugin command discovery failed", {
				error,
				severity: "warn",
			});
			return false;
		}
		if (
			!catalog.commands.some(
				(command) => command.name === parsed.command.slice(1),
			)
		)
			return false;
		const result = await commands.run({
			...commandTarget,
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
	};
}
