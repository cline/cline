/**
 * Plan-mode command blacklist for run_commands.
 *
 * Plan mode keeps run_commands available for read-only investigation, but
 * models (especially weaker ones) use it to edit files anyway. When the plan
 * preset sets `blockFileEditingCommands`, createShellTool checks each command
 * against this blacklist before executing and returns a tool error instead of
 * running anything that looks like a file modification.
 *
 * This is a simple blacklist, not a shell interpreter. Commands are lightly
 * preprocessed (quoted text, heredoc bodies, escapes, and comments are masked
 * so they cannot false-positive), split on shell separators, and the leading
 * command word of each part is compared against the lists below; output
 * redirection to files is also rejected. It will not catch every possible
 * mutation (e.g. `python -c "open(..., 'w')"` or commands hidden inside a
 * quoted `bash -c` string) — it exists to stop the common ways models edit
 * files from the shell, and entries are easy to add.
 */

import type { StructuredCommandInput } from "./schemas";

/** Commands that create, modify, or delete files. */
const BLOCKED_COMMANDS = new Set([
	// POSIX
	"rm",
	"rmdir",
	"unlink",
	"mv",
	"cp",
	"dd",
	"touch",
	"mkdir",
	"ln",
	"link",
	"chmod",
	"chown",
	"chgrp",
	"truncate",
	"shred",
	"install",
	"patch",
	"rsync",
	"mkfifo",
	"mknod",
	// Windows / PowerShell
	"del",
	"erase",
	"move",
	"ren",
	"rename",
	"md",
	"rd",
	"mklink",
	"copy",
	"xcopy",
	"robocopy",
	"new-item",
	"ni",
	"remove-item",
	"move-item",
	"copy-item",
	"rename-item",
	"set-content",
	"add-content",
	"clear-content",
	"out-file",
]);

/** Subcommands that mutate state, keyed by the command they belong to. */
const GIT_SUBCOMMANDS = new Set([
	"add",
	"am",
	"apply",
	"checkout",
	"cherry-pick",
	"clean",
	"clone",
	"commit",
	"init",
	"merge",
	"mv",
	"pull",
	"push",
	"rebase",
	"reset",
	"restore",
	"revert",
	"rm",
	"stash",
	"submodule",
	"switch",
	"worktree",
]);
const NODE_PM_SUBCOMMANDS = new Set([
	"install",
	"i",
	"ci",
	"add",
	"remove",
	"rm",
	"uninstall",
	"unlink",
	"link",
	"update",
	"up",
	"upgrade",
	"dedupe",
	"prune",
	"publish",
]);
const PIP_SUBCOMMANDS = new Set(["install", "uninstall", "add", "remove"]);
const CARGO_SUBCOMMANDS = new Set([
	"add",
	"remove",
	"rm",
	"install",
	"uninstall",
	"update",
	"new",
	"init",
	"publish",
]);
const SYSTEM_PM_SUBCOMMANDS = new Set([
	"install",
	"reinstall",
	"remove",
	"purge",
	"uninstall",
	"upgrade",
	"autoremove",
	"add",
	"del",
]);
const BLOCKED_SUBCOMMANDS: Record<string, Set<string>> = {
	git: GIT_SUBCOMMANDS,
	npm: NODE_PM_SUBCOMMANDS,
	pnpm: NODE_PM_SUBCOMMANDS,
	yarn: NODE_PM_SUBCOMMANDS,
	bun: NODE_PM_SUBCOMMANDS,
	pip: PIP_SUBCOMMANDS,
	pip3: PIP_SUBCOMMANDS,
	pipx: PIP_SUBCOMMANDS,
	uv: PIP_SUBCOMMANDS,
	cargo: CARGO_SUBCOMMANDS,
	apt: SYSTEM_PM_SUBCOMMANDS,
	"apt-get": SYSTEM_PM_SUBCOMMANDS,
	dnf: SYSTEM_PM_SUBCOMMANDS,
	yum: SYSTEM_PM_SUBCOMMANDS,
	apk: SYSTEM_PM_SUBCOMMANDS,
	brew: SYSTEM_PM_SUBCOMMANDS,
	snap: SYSTEM_PM_SUBCOMMANDS,
};

/** Prefix commands to skip over to reach the command that actually runs. */
const WRAPPERS = new Set([
	"sudo",
	"doas",
	"env",
	"command",
	"builtin",
	"nohup",
	"time",
	"nice",
	"stdbuf",
	"timeout",
	"xargs",
]);

/** Shell reserved words that can precede the command word. */
const RESERVED_WORDS = new Set([
	"if",
	"then",
	"else",
	"elif",
	"fi",
	"while",
	"until",
	"do",
	"done",
	"for",
	"case",
	"esac",
	"!",
	"{",
	"}",
]);

const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*\+?=/;

/**
 * Redirect targets that never persist data to a file. /tmp is also allowed:
 * the run_commands description tells models to capture long-running output in
 * a tmp file, and that never touches the workspace.
 */
function isAllowedRedirectTarget(rawTarget: string): boolean {
	const target = rawTarget.replace(/["']/g, "");
	return (
		/^(\/dev\/(null|stdout|stderr|tty)|nul:?)$/i.test(target) ||
		target.startsWith("/tmp/") ||
		target.startsWith("/var/tmp/") ||
		target.startsWith("$TMPDIR") ||
		target.startsWith("${TMPDIR")
	);
}

/** Basename, lowercased, quotes and a trailing .exe stripped. */
function normalizeCommandName(word: string): string {
	const base = word.replace(/["']/g, "").split(/[/\\]/).pop() ?? word;
	return base.toLowerCase().replace(/\.exe$/, "");
}

/**
 * Mask the parts of a command string that are data rather than commands, so
 * the blacklist scan below cannot false-positive on them: heredoc bodies are
 * dropped, and special characters inside quotes / behind backslash escapes /
 * after a comment marker are replaced with "_".
 */
function maskNonCommandText(command: string): string {
	// Drop heredoc bodies (everything between `<<DELIM` and the DELIM line).
	const lines = command.split("\n");
	const kept: string[] = [];
	let heredocDelimiter: string | undefined;
	for (const line of lines) {
		if (heredocDelimiter !== undefined) {
			if (line.replace(/^\t+/, "") === heredocDelimiter) {
				heredocDelimiter = undefined;
			}
			continue;
		}
		kept.push(line);
		const heredoc = line.match(
			/(?<![<])<<-?\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_./-]+))/,
		);
		if (heredoc) {
			heredocDelimiter = heredoc[1] ?? heredoc[2] ?? heredoc[3];
		}
	}
	return (
		kept
			.join("\n")
			// Backslash-escaped characters are literal text.
			.replace(/\\./g, "_")
			// Special characters inside quotes are literal text; spaces are
			// masked too so a quoted span stays a single token.
			.replace(/"[^"]*"|'[^']*'/g, (span) =>
				span.replace(/[\s<>|;&$()`#\\]/g, "_"),
			)
			// Comments.
			.replace(/(?:^|\s)#.*$/gm, " ")
	);
}

/** Check one command's tokens (command word + args) against the blacklist. */
function checkTokens(tokens: string[]): string | undefined {
	let index = 0;
	while (
		index < tokens.length &&
		(ENV_ASSIGNMENT.test(tokens[index]) || RESERVED_WORDS.has(tokens[index]))
	) {
		index += 1;
	}
	// Skip wrappers (sudo, env, xargs, timeout 30, ...) and their options.
	while (
		index < tokens.length &&
		WRAPPERS.has(normalizeCommandName(tokens[index]))
	) {
		index += 1;
		while (
			index < tokens.length &&
			(tokens[index].startsWith("-") ||
				ENV_ASSIGNMENT.test(tokens[index]) ||
				/^\d+[smhd]?$/.test(tokens[index]))
		) {
			index += 1;
		}
	}
	if (index >= tokens.length) {
		return undefined;
	}

	const name = normalizeCommandName(tokens[index]);
	const args = tokens.slice(index + 1);

	// `| tee /tmp/log` is the documented way to capture output; only file
	// arguments outside tmp are a mutation.
	if (name === "tee") {
		const fileArgs = args.filter((arg) => !arg.startsWith("-"));
		return fileArgs.some((arg) => !isAllowedRedirectTarget(arg))
			? "`tee`"
			: undefined;
	}

	if (BLOCKED_COMMANDS.has(name)) {
		return `\`${name}\``;
	}

	const subcommands = BLOCKED_SUBCOMMANDS[name];
	if (subcommands) {
		// First non-option arg is the subcommand; `git -c k=v` / `git -C dir`
		// take a value, so skip that too.
		let cursor = 0;
		while (cursor < args.length && args[cursor].startsWith("-")) {
			cursor += name === "git" && /^-[cC]$/.test(args[cursor]) ? 2 : 1;
		}
		const subcommand = args[cursor]?.toLowerCase();
		if (subcommand && subcommands.has(subcommand)) {
			return `\`${name} ${subcommand}\``;
		}
		return undefined;
	}

	// In-place edit flags on otherwise read-only text tools.
	if (
		(name === "sed" || name === "gsed") &&
		args.some((arg) => /^-[a-z]*i/i.test(arg) || arg.startsWith("--in-place"))
	) {
		return "`sed -i` (in-place edit)";
	}
	if (name === "perl" && args.some((arg) => /^-[a-z]*i/i.test(arg))) {
		return "`perl -i` (in-place edit)";
	}
	if (/^[gnm]?awk$/.test(name) && args.some((arg) => arg.includes("inplace"))) {
		return "`awk -i inplace` (in-place edit)";
	}
	if (
		name === "sort" &&
		args.some((arg) => arg.startsWith("-o") || arg.startsWith("--output"))
	) {
		return "`sort -o` (writes a file)";
	}
	if (name === "find" && args.includes("-delete")) {
		return "`find -delete`";
	}

	return undefined;
}

/**
 * Inspect a run_commands entry and return a short description of the first
 * file-modifying construct found, or undefined when the command looks
 * read-only.
 */
export function findFileEditingCommand(
	command: string | StructuredCommandInput,
): string | undefined {
	if (typeof command !== "string") {
		// Structured argv is executed without shell parsing, so only the
		// executable and argv matter (a ">" argument is a literal string).
		return checkTokens([command.command, ...(command.args ?? [])]);
	}

	const masked = maskNonCommandText(command);

	// Output redirection to a file (`>`, `>>`, `&>`), allowing /dev sinks,
	// fd duplication (`2>&1`, `>&2`), and /tmp output capture.
	const redirects = masked.matchAll(
		/(?:^|[^<>])(?:>{1,2}|&>{1,2})\s*([^\s;&|<>()]+)/g,
	);
	for (const redirect of redirects) {
		if (!isAllowedRedirectTarget(redirect[1])) {
			return `output redirection (\`> ${redirect[1]}\`)`;
		}
	}

	// Check the command word of every simple command in the string.
	for (const segment of masked.split(/[\n;|&()`]+/)) {
		const blocked = checkTokens(segment.trim().split(/\s+/).filter(Boolean));
		if (blocked) {
			return blocked;
		}
	}
	return undefined;
}

/**
 * Tool error returned in place of executing a blocked command in plan mode.
 */
export function formatPlanModeBlockedCommandError(reason: string): string {
	return (
		`Command not executed: ${reason} can modify files, and file modifications are blocked in plan mode. ` +
		"You are in PLAN MODE — explore, analyze, and present a plan; do not make changes. " +
		"Use read-only commands to inspect the project (redirecting output to /tmp is allowed), " +
		"and if this change is part of the task, put it in your plan so it can run after the user approves switching to act mode."
	);
}
