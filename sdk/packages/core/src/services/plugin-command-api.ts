import type {
	AgentExtensionCommand,
	AgentExtensionCommandResult,
	ITelemetryService,
} from "@cline/shared";
import { createSessionId } from "@cline/shared";
import {
	captureToolUsage,
	type TelemetryAgentIdentityProperties,
} from "./telemetry/core-events";

export interface PluginSlashCommand {
	name: string;
	description?: string;
}
export interface PluginCommandResult {
	reply?: string;
	submitPrompt?: string;
}
export interface PluginCommandTarget {
	workspacePath: string;
	/** Use the resident session's plugins, including their session-local state. */
	sessionId?: string;
}
export interface PluginCommandCatalog extends PluginCommandTarget {
	status: "ready" | "error";
	commands: PluginSlashCommand[];
	error?: string;
}
/**
 * Owned by the runtime. Clients neither load plugins nor own their sandboxes.
 * Every call checks plugin sources, so re-listing is how clients stay current.
 */
export interface PluginCommandsApi {
	list(target: PluginCommandTarget): Promise<PluginCommandCatalog>;
	run(
		input: PluginCommandTarget & { prompt: string },
	): Promise<PluginCommandResult | undefined>;
}
export interface PluginCommandsRuntimeService {
	readonly pluginCommands: PluginCommandsApi;
}
export function normalizePluginCommandName(name: string): string {
	return name.trim().replace(/^\/+/, "").toLowerCase();
}
export function parsePluginCommand(
	input: string,
): { name: string; input: string } | undefined {
	const match = input.trimStart().match(/^\/(\S+)([\s\S]*)$/);
	return match
		? { name: normalizePluginCommandName(match[1]), input: match[2].trim() }
		: undefined;
}
export function normalizePluginCommandResult(
	result: AgentExtensionCommandResult | undefined,
): PluginCommandResult {
	const value = typeof result === "string" ? { reply: result } : result;
	return {
		reply: value?.reply?.trim() || undefined,
		submitPrompt: value?.submitPrompt?.trim() || undefined,
	};
}
export function listPluginCommands(
	commands: readonly AgentExtensionCommand[],
): PluginSlashCommand[] {
	const result = new Map<string, PluginSlashCommand>();
	for (const command of commands) {
		const name = normalizePluginCommandName(command.name);
		if (!name || /\s/.test(name) || !command.handler || result.has(name))
			continue;
		result.set(name, { name, description: command.description });
	}
	return [...result.values()];
}
export async function executePluginCommand(
	commands: readonly AgentExtensionCommand[],
	prompt: string,
	context: {
		telemetry?: ITelemetryService;
		sessionId?: string;
		modelId?: string;
		provider?: string;
		agentIdentity?: TelemetryAgentIdentityProperties;
	} = {},
): Promise<PluginCommandResult | undefined> {
	const parsed = parsePluginCommand(prompt);
	if (!parsed) return undefined;
	const command = commands.find(
		(command) =>
			normalizePluginCommandName(command.name) === parsed.name &&
			command.handler,
	);
	if (!command?.handler) return undefined;
	let success = false;
	try {
		const result = normalizePluginCommandResult(
			await command.handler(parsed.input),
		);
		success = true;
		return result;
	} finally {
		try {
			captureToolUsage(context.telemetry, {
				ulid: context.sessionId ?? createSessionId(),
				tool: `plugin_command:${parsed.name}`,
				modelId: context.modelId,
				provider: context.provider,
				success,
				...context.agentIdentity,
			});
		} catch {
			// Telemetry must never replace a completed action's result or original error.
		}
	}
}
