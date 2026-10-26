import {
	createHubPluginCommandsApi,
	type PluginCommandResult,
	parsePluginCommand,
} from "@cline/core";
import { getSessionRuntimeBinding } from "./context";
import type { SidecarContext } from "./types";

/**
 * The runtime rejects a session command whose workspace differs from the
 * session's `workspaceRoot ?? cwd`, so target the live session the same way.
 */
function sessionWorkspacePath(
	ctx: SidecarContext,
	sessionId: string | undefined,
	fallback: string,
): string {
	const config = sessionId
		? ctx.liveSessions.get(sessionId)?.config
		: undefined;
	for (const value of [config?.workspaceRoot, config?.cwd]) {
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	return fallback;
}

export async function listPluginCommands(
	ctx: SidecarContext,
	workspacePath: string,
	sessionId?: string,
	environmentId?: string,
) {
	const client = getSessionRuntimeBinding(
		ctx,
		sessionId,
		environmentId,
	).hubClient;
	return createHubPluginCommandsApi(client).list({
		workspacePath: sessionWorkspacePath(ctx, sessionId, workspacePath),
		sessionId,
	});
}

const NEXT_TURN_COMMAND = "/next --format=json";
const MAX_NEXT_TURN_SUGGESTIONS = 3;
const MAX_NEXT_TURN_PROMPT_CHARS = 2_000;

/** Parses the plugin's small wire reply into the only data the composer needs. */
export function parseNextTurnSuggestionsReply(
	reply: string | undefined,
): readonly string[] {
	if (!reply) return [];
	try {
		const value: unknown = JSON.parse(reply);
		if (!value || typeof value !== "object" || Array.isArray(value)) {
			return [];
		}
		const { v, suggestions } = value as Record<string, unknown>;
		if (
			v !== 1 ||
			!Array.isArray(suggestions) ||
			suggestions.length > MAX_NEXT_TURN_SUGGESTIONS ||
			!suggestions.every(
				(prompt) =>
					typeof prompt === "string" &&
					prompt.trim().length > 0 &&
					prompt.length <= MAX_NEXT_TURN_PROMPT_CHARS,
			)
		) {
			return [];
		}
		return suggestions.map((prompt: string) => prompt.trim());
	} catch {
		return [];
	}
}

/** Reads the current set without creating chat output or submitting a prompt. */
export async function readNextTurnSuggestions(
	ctx: SidecarContext,
	input: {
		workspacePath: string;
		sessionId: string;
		environmentId?: string;
	},
): Promise<readonly string[]> {
	try {
		const commands = createHubPluginCommandsApi(
			getSessionRuntimeBinding(ctx, input.sessionId, input.environmentId)
				.hubClient,
		);
		const result = await commands.run({
			workspacePath: sessionWorkspacePath(
				ctx,
				input.sessionId,
				input.workspacePath,
			),
			sessionId: input.sessionId,
			prompt: NEXT_TURN_COMMAND,
		});
		return parseNextTurnSuggestionsReply(result?.reply);
	} catch (error) {
		ctx.logger?.debug("Next Turn suggestion lookup failed", { error });
		return [];
	}
}

export async function runPluginSlashCommand(
	ctx: SidecarContext,
	input: {
		workspacePath: string;
		prompt: string;
		sessionId: string;
		environmentId?: string;
	},
): Promise<PluginCommandResult | undefined> {
	const commands = createHubPluginCommandsApi(
		getSessionRuntimeBinding(ctx, input.sessionId, input.environmentId)
			.hubClient,
	);
	const target = {
		workspacePath: sessionWorkspacePath(
			ctx,
			input.sessionId,
			input.workspacePath,
		),
		sessionId: input.sessionId,
	};
	// A failed catalog read must not block skills and workflows sharing the
	// slash syntax. Only a listed plugin command may fail the send.
	try {
		const name = parsePluginCommand(input.prompt)?.name;
		const catalog = await commands.list(target);
		if (!catalog.commands.some((command) => command.name === name))
			return undefined;
	} catch (error) {
		ctx.logger?.log("Plugin command discovery failed", {
			error,
			severity: "warn",
		});
		return undefined;
	}
	return commands.run({ ...target, prompt: input.prompt });
}
