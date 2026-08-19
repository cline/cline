import { createUserInstructionConfigService } from "@cline/core";
import { normalizeUserInput, stripModeNotices } from "@cline/shared";

/**
 * Display-side inversion of slash command expansion.
 *
 * Workflow slash commands (and, in sessions recorded before skills switched
 * to the skills tool, skill commands too) were expanded into their
 * instruction text before dispatch, so the runtime's persisted transcript
 * holds the instructions as the user message. The desktop webview re-hydrates
 * its transcript from that history after every turn, so the history
 * projection recovers the typed `/command` here: a user message produced by
 * expansion starts with a configured command's instructions, which is
 * invertible back to `/name remainder`.
 */

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
 *
 * Known trade-off: a message the user hand-typed with a command's exact
 * instructions as its prefix persists byte-identically to that command's
 * expansion, so it collapses to the `/command` form too. The two are
 * indistinguishable from stored history alone (the model received the same
 * text either way), and the collapsed form still names the instructions the
 * message carried.
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
