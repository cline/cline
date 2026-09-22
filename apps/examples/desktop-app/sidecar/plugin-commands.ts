import {
	type AgentExtensionCommandResult,
	createContributionRegistry,
	listPluginToolsWithDiagnostics,
	resolveAndLoadAgentPlugins,
} from "@cline/core";
import type { AgentTool, Message } from "@cline/shared";

export type PluginSlashCommandResult = {
	name: string;
	reply?: string;
	submitPrompt?: string;
};

function normalizeCommandName(name: string): string {
	return name.trim().replace(/^\/+/, "").toLowerCase();
}

function normalizeCommandResult(
	name: string,
	result: AgentExtensionCommandResult | undefined,
): PluginSlashCommandResult {
	if (typeof result === "string") {
		const reply = result.trim();
		return reply ? { name, reply } : { name };
	}
	if (!result || typeof result !== "object") {
		return { name };
	}
	const reply = result.reply?.trim();
	const submitPrompt = result.submitPrompt?.trim();
	return {
		name,
		...(reply ? { reply } : {}),
		...(submitPrompt ? { submitPrompt } : {}),
	};
}

/**
 * Run a plugin-registered slash command (`api.registerCommand`) for the
 * leading `/name` token of a prompt. Returns undefined when no enabled plugin
 * declares the command so the prompt continues through the normal path.
 *
 * The contribution inventory is cached per plugin mtime, so the (comparatively
 * expensive) sandbox load only happens for prompts that actually target a
 * plugin command.
 */
export async function runPluginSlashCommand(input: {
	workspacePath: string;
	prompt: string;
}): Promise<PluginSlashCommandResult | undefined> {
	const match = input.prompt.match(/^\/(\S+)([\s\S]*)$/);
	const name = match?.[1] ? normalizeCommandName(match[1]) : "";
	if (!name) return undefined;
	const inventory = await listPluginToolsWithDiagnostics({
		workspacePath: input.workspacePath,
		cwd: input.workspacePath,
	});
	if (
		!inventory.plugins.some((plugin) =>
			plugin.commands.some((command) => normalizeCommandName(command) === name),
		)
	) {
		return undefined;
	}

	const loaded = await resolveAndLoadAgentPlugins({
		cwd: input.workspacePath,
		workspacePath: input.workspacePath,
	});
	try {
		const registry = createContributionRegistry<
			(typeof loaded.extensions)[number],
			AgentTool,
			Message[]
		>({ extensions: loaded.extensions });
		await registry.initialize();
		const command = registry
			.getRegistrySnapshot()
			.commands.find(
				(candidate) =>
					normalizeCommandName(candidate.name) === name &&
					typeof candidate.handler === "function",
			);
		if (!command?.handler) return undefined;
		return normalizeCommandResult(
			name,
			await command.handler((match?.[2] ?? "").trim()),
		);
	} finally {
		await loaded.shutdown?.().catch(() => {
			// Best effort sandbox cleanup after a one-shot command.
		});
	}
}
