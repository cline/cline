import { createUserInstructionConfigService } from "@cline/core";
import { normalizeUserInput, stripModeNotices } from "@cline/shared";
import type { LiveSession } from "./types";

/**
 * Display-side handling for slash command expansion.
 *
 * The sidecar expands a leading `/skill` or `/workflow` token into its
 * configured instructions before dispatching a prompt, so the runtime (and
 * its persisted transcript) only ever sees the expanded text. The CLI TUI
 * solves the display side by keeping the typed text in its own transcript;
 * the desktop webview instead re-hydrates from the runtime's history after
 * every turn, so the typed command has to be recovered here, in the sidecar's
 * display boundaries. Two mechanisms cover them:
 *
 * 1. A per-session map from the dispatched runtime prompt back to the typed
 *    prompt, recorded at expansion time. Used by the synchronous queue
 *    boundaries (pending-prompt snapshots and chat_queued_prompt_start
 *    events), which echo the runtime's copy of the prompt.
 * 2. An inverter for persisted transcript text: a user message produced by
 *    expansion starts with a configured command's instructions, so it can be
 *    rewritten back to `/name remainder`. Used by the history projection,
 *    which also covers sessions reopened after a restart.
 */

const MAX_TRACKED_PROMPTS = 32;

/**
 * Remember the prompt the user actually typed for a runtime prompt produced
 * by slash command expansion or rewriting. No-op when nothing changed.
 */
export function recordTypedPrompt(
	session: LiveSession | undefined,
	runtimePrompt: string,
	typedPrompt: string,
): void {
	if (!session || !runtimePrompt || runtimePrompt === typedPrompt) {
		return;
	}
	const map = (session.typedPromptByRuntimePrompt ??= new Map());
	// Re-insert to refresh recency before trimming the oldest entries.
	map.delete(runtimePrompt);
	map.set(runtimePrompt, typedPrompt);
	while (map.size > MAX_TRACKED_PROMPTS) {
		const oldest = map.keys().next().value;
		if (oldest === undefined) {
			break;
		}
		map.delete(oldest);
	}
}

/** The typed form of a runtime prompt, when known; the prompt otherwise. */
export function displayPromptFor(
	session: LiveSession | undefined,
	runtimePrompt: string | undefined,
): string {
	const prompt = runtimePrompt ?? "";
	return session?.typedPromptByRuntimePrompt?.get(prompt) ?? prompt;
}

export type SlashCommandDisplayInverter = (content: string) => string;

type InvertibleCommand = {
	name: string;
	instructions: string;
};

type CommandCacheEntry = {
	expiresAt: number;
	commands: InvertibleCommand[];
};

// Loading commands scans the skill/workflow directories; history projection
// runs several times per turn, so cache the snapshot briefly per workspace.
const COMMAND_CACHE_TTL_MS = 10_000;
const commandCache = new Map<string, CommandCacheEntry>();

/** Test hook: forget cached command snapshots. */
export function clearSlashCommandDisplayCache(): void {
	commandCache.clear();
}

async function loadInvertibleCommands(
	workspacePath: string | undefined,
): Promise<InvertibleCommand[]> {
	const key = workspacePath ?? "";
	const cached = commandCache.get(key);
	if (cached && cached.expiresAt > Date.now()) {
		return cached.commands;
	}
	const service = createUserInstructionConfigService({
		skills: { workspacePath },
		rules: { workspacePath },
		workflows: { workspacePath },
	});
	let commands: InvertibleCommand[] = [];
	try {
		await service.start();
		commands = service
			.listRuntimeCommands()
			.map((command) => ({
				name: command.name,
				instructions: command.instructions.trim(),
			}))
			.filter((command) => command.instructions.length > 0)
			// Longest instructions first so a command whose instructions are a
			// prefix of another's cannot shadow the longer match.
			.sort((a, b) => b.instructions.length - a.instructions.length);
	} finally {
		service.stop();
	}
	commandCache.set(key, {
		expiresAt: Date.now() + COMMAND_CACHE_TTL_MS,
		commands,
	});
	return commands;
}

/**
 * Builds an inverter that maps persisted user-message text produced by slash
 * command expansion back to the typed `/command remainder` form. Text that
 * does not start with a configured command's instructions is returned
 * unchanged, including when command discovery fails.
 */
export async function createSlashCommandDisplayInverter(
	workspacePath: string | undefined,
): Promise<SlashCommandDisplayInverter> {
	let commands: InvertibleCommand[] = [];
	try {
		commands = await loadInvertibleCommands(workspacePath);
	} catch {
		commands = [];
	}
	if (commands.length === 0) {
		return (content) => content;
	}
	return (content) => {
		// Persisted user text carries the <user_input> wrapper and possibly a
		// prepended <mode_notice>; compare against what the expansion injected.
		const inner = stripModeNotices(normalizeUserInput(content));
		if (!inner) {
			return content;
		}
		for (const command of commands) {
			if (!inner.startsWith(command.instructions)) {
				continue;
			}
			const remainder = inner.slice(command.instructions.length);
			// The expansion only ever appends what followed the typed token,
			// which is empty or starts with whitespace.
			if (remainder && !/^\s/.test(remainder)) {
				continue;
			}
			return `/${command.name}${remainder}`;
		}
		return content;
	};
}
