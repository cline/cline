import type { AgentExtensionCommand } from "@cline/shared";

const pluginCommands = new WeakSet<AgentExtensionCommand>();

/** Record a command registered by a loaded plugin, from either execution mode. */
export function markPluginCommand(
	command: AgentExtensionCommand,
): AgentExtensionCommand {
	pluginCommands.add(command);
	return command;
}

/**
 * Whether a registered command came from a loaded plugin. Session registries
 * also hold built-in skill and workflow commands, which are not plugin commands.
 */
export function isPluginCommand(command: AgentExtensionCommand): boolean {
	return pluginCommands.has(command);
}
