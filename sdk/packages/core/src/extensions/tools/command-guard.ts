/**
 * Plan-Mode Command Guard
 *
 * Plan mode keeps run_commands available for read-only investigation, but the
 * behavioral contract ("never use it to change anything") was previously
 * enforced only by prompting. This module is the hard backstop: it inspects a
 * shell command before execution and reports the first file-modifying
 * construct it finds, so the tool can refuse to run it and return an error
 * instead.
 *
 * Detection is a quote/heredoc-aware scan of the command string, split into
 * simple-command segments (`&&`, `||`, `;`, `|`, subshells, command
 * substitution). Each segment is checked for:
 *
 * - output redirection to a file (`>`, `>>`, `&>`, ...), except /dev sinks
 *   and /tmp paths (the tool description tells models to capture long-running
 *   output under /tmp, which never touches the workspace)
 * - file-manipulation commands (rm, mv, cp, tee, touch, mkdir, chmod, ...),
 *   including common Windows/PowerShell equivalents
 * - in-place edit flags (`sed -i`, `perl -i`, `gawk -i inplace`, `sort -o`)
 * - git subcommands that change the working tree, index, or history
 * - package-manager mutations (npm/yarn/pnpm/bun/pip/cargo/brew/apt installs
 *   and removals)
 * - `find -delete` / `find -exec <mutator>`, and nested command strings
 *   (`sh -c`, `eval`, `xargs`, `sudo`, ...)
 *
 * The guard is deliberately a denylist: it cannot prove a command is safe
 * (e.g. `python -c "open(...,'w')"` passes through), it only blocks the
 * common ways models edit files from the shell. False negatives are
 * acceptable; false positives on genuinely read-only commands are what the
 * parser works hard to avoid (quoted `>` characters, heredoc bodies, awk
 * comparison expressions, etc. are not flagged).
 */

import type { StructuredCommandInput } from "./schemas";

const MAX_NESTED_COMMAND_DEPTH = 5;

/** Commands that always create, modify, or delete files. */
const FILE_MUTATING_COMMANDS = new Set([
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
	// Windows shell builtins / utilities
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
	// PowerShell cmdlets and unambiguous aliases
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
	"set-itemproperty",
	"new-itemproperty",
	"remove-itemproperty",
]);

/**
 * Prefix commands that wrap another command; the guard skips them (and their
 * options) to find the command that actually runs.
 */
const WRAPPER_COMMANDS = new Set([
	"sudo",
	"doas",
	"env",
	"command",
	"builtin",
	"exec",
	"nohup",
	"time",
	"nice",
	"ionice",
	"stdbuf",
	"timeout",
	"xargs",
	"busybox",
]);

/** Shell reserved words that can precede the command word in a segment. */
const SHELL_RESERVED_WORDS = new Set([
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
	"function",
	"select",
	"!",
	"{",
	"}",
]);

/** Git subcommands that change the working tree, index, refs, or history. */
const GIT_MUTATING_SUBCOMMANDS = new Set([
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
	"filter-branch",
]);

const NODE_PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn", "bun"]);
const NODE_PM_MUTATING_SUBCOMMANDS = new Set([
	"install",
	"i",
	"ci",
	"add",
	"remove",
	"rm",
	"r",
	"un",
	"uninstall",
	"unlink",
	"link",
	"ln",
	"update",
	"up",
	"upgrade",
	"dedupe",
	"prune",
	"rebuild",
	"publish",
	"pkg",
	"patch",
	"patch-commit",
]);

const PYTHON_PACKAGE_MANAGERS = new Set(["pip", "pip3", "pipx", "uv"]);
const PYTHON_PM_MUTATING_SUBCOMMANDS = new Set([
	"install",
	"uninstall",
	"add",
	"remove",
	"sync",
]);

const CARGO_MUTATING_SUBCOMMANDS = new Set([
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

const SYSTEM_PACKAGE_MANAGERS = new Set([
	"apt",
	"apt-get",
	"dnf",
	"yum",
	"apk",
	"brew",
	"snap",
]);
const SYSTEM_PM_MUTATING_SUBCOMMANDS = new Set([
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

const POSIX_SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish"]);
const POWERSHELLS = new Set(["pwsh", "powershell"]);

/**
 * Redirect targets that never persist data to a file. Writing under /tmp is
 * also allowed: the run_commands description explicitly tells models to
 * capture long-running output in a tmp file, and that pattern is read-only
 * with respect to the workspace.
 */
function isAllowedRedirectTarget(target: string): boolean {
	const normalized = target.toLowerCase();
	if (
		normalized === "/dev/null" ||
		normalized === "/dev/stdout" ||
		normalized === "/dev/stderr" ||
		normalized === "/dev/tty" ||
		normalized === "nul" ||
		normalized === "nul:"
	) {
		return true;
	}
	return (
		target.startsWith("/tmp/") ||
		target.startsWith("/var/tmp/") ||
		target.startsWith("$TMPDIR") ||
		target.startsWith("${TMPDIR")
	);
}

function isTmpPath(target: string): boolean {
	return (
		target.startsWith("/tmp/") ||
		target.startsWith("/var/tmp/") ||
		target.startsWith("$TMPDIR") ||
		target.startsWith("${TMPDIR")
	);
}

// =============================================================================
// Tokenizer
// =============================================================================

type SegmentToken =
	| { kind: "word"; value: string }
	| { kind: "write-redirect"; target: string };

/**
 * Split a shell command string into simple-command segments of tokens,
 * respecting quoting, escapes, comments, and heredoc bodies. Command
 * substitutions (`$(...)`, backticks) and process substitutions are scanned
 * recursively and their segments appended to the output.
 */
function tokenizeSegments(command: string, depth: number): SegmentToken[][] {
	const segments: SegmentToken[][] = [];
	let segment: SegmentToken[] = [];
	let current = "";
	let hasCurrent = false;
	const pendingHeredocs: Array<{ delimiter: string; stripTabs: boolean }> = [];
	let i = 0;
	const n = command.length;

	const pushWord = () => {
		if (hasCurrent) {
			segment.push({ kind: "word", value: current });
			current = "";
			hasCurrent = false;
		}
	};
	const endSegment = () => {
		pushWord();
		if (segment.length > 0) {
			segments.push(segment);
			segment = [];
		}
	};
	/** Read the next whitespace/operator-delimited word (for redirect targets). */
	const readWord = (): string => {
		while (i < n && (command[i] === " " || command[i] === "\t")) {
			i += 1;
		}
		let out = "";
		while (i < n) {
			const ch = command[i];
			if (ch === "'") {
				const end = command.indexOf("'", i + 1);
				if (end === -1) {
					out += command.slice(i + 1);
					i = n;
				} else {
					out += command.slice(i + 1, end);
					i = end + 1;
				}
				continue;
			}
			if (ch === '"') {
				i += 1;
				while (i < n && command[i] !== '"') {
					if (command[i] === "\\" && i + 1 < n) {
						out += command[i + 1];
						i += 2;
					} else {
						out += command[i];
						i += 1;
					}
				}
				i += 1;
				continue;
			}
			if (ch === "\\" && i + 1 < n) {
				out += command[i + 1];
				i += 2;
				continue;
			}
			if (" \t\n;&|<>()`".includes(ch)) {
				break;
			}
			out += ch;
			i += 1;
		}
		return out;
	};
	/** Recursively tokenize an embedded command (substitutions). */
	const recurse = (inner: string) => {
		if (depth < MAX_NESTED_COMMAND_DEPTH) {
			segments.push(...tokenizeSegments(inner, depth + 1));
		}
	};
	/**
	 * Find the `)` matching an already-consumed `(`, respecting quotes and
	 * nested parentheses. Returns -1 when unbalanced.
	 */
	const findClosingParen = (start: number): number => {
		let cursor = start;
		let parenDepth = 1;
		while (cursor < n) {
			const ch = command[cursor];
			if (ch === "\\") {
				cursor += 2;
				continue;
			}
			if (ch === "'") {
				const end = command.indexOf("'", cursor + 1);
				cursor = end === -1 ? n : end + 1;
				continue;
			}
			if (ch === '"') {
				cursor += 1;
				while (cursor < n && command[cursor] !== '"') {
					cursor += command[cursor] === "\\" ? 2 : 1;
				}
				cursor += 1;
				continue;
			}
			if (ch === "(") {
				parenDepth += 1;
			} else if (ch === ")") {
				parenDepth -= 1;
				if (parenDepth === 0) {
					return cursor;
				}
			}
			cursor += 1;
		}
		return -1;
	};

	while (i < n) {
		const ch = command[i];

		if (ch === "\n") {
			endSegment();
			i += 1;
			// Heredoc bodies are data, not commands: skip lines until each
			// pending delimiter so `>` etc. inside the body is not flagged.
			while (pendingHeredocs.length > 0 && i < n) {
				const heredoc = pendingHeredocs.shift();
				if (!heredoc) {
					break;
				}
				while (i < n) {
					let lineEnd = command.indexOf("\n", i);
					if (lineEnd === -1) {
						lineEnd = n;
					}
					let line = command.slice(i, lineEnd);
					if (heredoc.stripTabs) {
						line = line.replace(/^\t+/, "");
					}
					i = lineEnd < n ? lineEnd + 1 : n;
					if (line === heredoc.delimiter) {
						break;
					}
				}
			}
			continue;
		}

		if (ch === " " || ch === "\t") {
			pushWord();
			i += 1;
			continue;
		}

		if (ch === "\\") {
			if (i + 1 < n) {
				if (command[i + 1] !== "\n") {
					current += command[i + 1];
					hasCurrent = true;
				}
				i += 2;
			} else {
				i += 1;
			}
			continue;
		}

		if (ch === "'") {
			const end = command.indexOf("'", i + 1);
			hasCurrent = true;
			if (end === -1) {
				current += command.slice(i + 1);
				i = n;
			} else {
				current += command.slice(i + 1, end);
				i = end + 1;
			}
			continue;
		}

		if (ch === '"') {
			i += 1;
			hasCurrent = true;
			while (i < n) {
				const inner = command[i];
				if (inner === '"') {
					i += 1;
					break;
				}
				if (inner === "\\" && i + 1 < n) {
					current += command[i + 1];
					i += 2;
					continue;
				}
				if (inner === "$" && command[i + 1] === "(") {
					const close = findClosingParen(i + 2);
					if (close === -1) {
						current += inner;
						i += 1;
						continue;
					}
					recurse(command.slice(i + 2, close));
					i = close + 1;
					continue;
				}
				if (inner === "`") {
					const close = command.indexOf("`", i + 1);
					if (close === -1) {
						current += inner;
						i += 1;
						continue;
					}
					recurse(command.slice(i + 1, close));
					i = close + 1;
					continue;
				}
				current += inner;
				i += 1;
			}
			continue;
		}

		if (ch === "#" && !hasCurrent) {
			const lineEnd = command.indexOf("\n", i);
			i = lineEnd === -1 ? n : lineEnd;
			continue;
		}

		if (ch === "$" && command[i + 1] === "(") {
			// Arithmetic expansion $((...)) contains no commands.
			if (command[i + 2] === "(") {
				const close = findClosingParen(i + 3);
				hasCurrent = true;
				i = close === -1 ? n : close + 2;
				continue;
			}
			const close = findClosingParen(i + 2);
			hasCurrent = true;
			if (close === -1) {
				i = n;
				continue;
			}
			recurse(command.slice(i + 2, close));
			i = close + 1;
			continue;
		}

		if (ch === "`") {
			const close = command.indexOf("`", i + 1);
			pushWord();
			if (close === -1) {
				i = n;
				continue;
			}
			recurse(command.slice(i + 1, close));
			i = close + 1;
			continue;
		}

		if (ch === ";") {
			endSegment();
			i += 1;
			continue;
		}

		if (ch === "&") {
			if (command[i + 1] === ">") {
				// &> and &>> redirect stdout+stderr to a file.
				pushWord();
				i += command[i + 2] === ">" ? 3 : 2;
				const target = readWord();
				if (target) {
					segment.push({ kind: "write-redirect", target });
				}
				continue;
			}
			endSegment();
			i += command[i + 1] === "&" ? 2 : 1;
			continue;
		}

		if (ch === "|") {
			endSegment();
			i += command[i + 1] === "|" || command[i + 1] === "&" ? 2 : 1;
			continue;
		}

		if (ch === "(" || ch === ")") {
			endSegment();
			i += 1;
			continue;
		}

		if (ch === "<") {
			// A pure-digit token before a redirect is a file descriptor.
			if (hasCurrent && /^\d+$/.test(current)) {
				current = "";
				hasCurrent = false;
			} else {
				pushWord();
			}
			if (command[i + 1] === "<") {
				if (command[i + 2] === "<") {
					i += 3;
					readWord(); // here-string payload
					continue;
				}
				i += 2;
				let stripTabs = false;
				if (command[i] === "-") {
					stripTabs = true;
					i += 1;
				}
				const delimiter = readWord();
				if (delimiter) {
					pendingHeredocs.push({ delimiter, stripTabs });
				}
				continue;
			}
			if (command[i + 1] === "(") {
				const close = findClosingParen(i + 2);
				if (close === -1) {
					i = n;
					continue;
				}
				recurse(command.slice(i + 2, close));
				i = close + 1;
				continue;
			}
			i += 1;
			readWord(); // input redirect source is a read
			continue;
		}

		if (ch === ">") {
			if (hasCurrent && /^\d+$/.test(current)) {
				current = "";
				hasCurrent = false;
			} else {
				pushWord();
			}
			// >(cmd) process substitution: the inner command is scanned; the
			// redirection itself pipes to that command, not to a file.
			if (command[i + 1] === "(") {
				const close = findClosingParen(i + 2);
				if (close === -1) {
					i = n;
					continue;
				}
				recurse(command.slice(i + 2, close));
				i = close + 1;
				continue;
			}
			if (command[i + 1] === "&") {
				i += 2;
				const target = readWord();
				// >&2 / >&- duplicate a descriptor; >&file writes a file.
				if (target && !/^\d+$/.test(target) && target !== "-") {
					segment.push({ kind: "write-redirect", target });
				}
				continue;
			}
			i += command[i + 1] === ">" || command[i + 1] === "|" ? 2 : 1;
			const target = readWord();
			if (target) {
				segment.push({ kind: "write-redirect", target });
			}
			continue;
		}

		current += ch;
		hasCurrent = true;
		i += 1;
	}

	endSegment();
	return segments;
}

// =============================================================================
// Simple-command analysis
// =============================================================================

function isEnvAssignment(word: string): boolean {
	return /^[A-Za-z_][A-Za-z0-9_]*\+?=/.test(word);
}

/** Basename, lowercased, with a trailing .exe stripped. */
function normalizeCommandName(word: string): string {
	const base = word.split(/[/\\]/).pop() ?? word;
	return base.toLowerCase().replace(/\.exe$/, "");
}

function hasCombinedShortFlag(args: string[], letter: string): boolean {
	for (const arg of args) {
		if (arg === "--") {
			break;
		}
		if (/^-[A-Za-z]/.test(arg) && arg.slice(1).includes(letter)) {
			return true;
		}
	}
	return false;
}

function findFirstPositionalArg(args: string[]): string | undefined {
	for (const arg of args) {
		if (arg === "--") {
			continue;
		}
		if (!arg.startsWith("-")) {
			return arg;
		}
	}
	return undefined;
}

function checkGitCommand(args: string[]): string | undefined {
	let index = 0;
	while (index < args.length) {
		const arg = args[index];
		if (arg === "-c" || arg === "-C") {
			index += 2;
			continue;
		}
		if (arg.startsWith("-")) {
			index += 1;
			continue;
		}
		break;
	}
	const subcommand = args[index]?.toLowerCase();
	if (subcommand && GIT_MUTATING_SUBCOMMANDS.has(subcommand)) {
		return `\`git ${subcommand}\``;
	}
	return undefined;
}

function checkFindCommand(args: string[], depth: number): string | undefined {
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "-delete") {
			return "`find -delete`";
		}
		if (
			arg === "-exec" ||
			arg === "-execdir" ||
			arg === "-ok" ||
			arg === "-okdir"
		) {
			const tail: string[] = [];
			for (
				let cursor = index + 1;
				cursor < args.length && args[cursor] !== ";" && args[cursor] !== "+";
				cursor += 1
			) {
				tail.push(args[cursor]);
			}
			const nested = checkWords(tail, depth + 1);
			if (nested) {
				return nested;
			}
		}
	}
	return undefined;
}

/**
 * Check one simple command (command word + args) against the blocklist.
 * Returns a short human-readable description of the offending construct, or
 * undefined when the command looks read-only.
 */
function checkWords(words: string[], depth: number): string | undefined {
	if (depth > MAX_NESTED_COMMAND_DEPTH) {
		return undefined;
	}

	let index = 0;
	while (
		index < words.length &&
		(isEnvAssignment(words[index]) || SHELL_RESERVED_WORDS.has(words[index]))
	) {
		index += 1;
	}

	// Unwrap prefix commands (sudo, env, xargs, timeout, ...) to reach the
	// command they run.
	while (index < words.length) {
		const wrapper = normalizeCommandName(words[index]);
		if (!WRAPPER_COMMANDS.has(wrapper)) {
			break;
		}
		index += 1;
		while (
			index < words.length &&
			(words[index].startsWith("-") ||
				(wrapper === "env" && isEnvAssignment(words[index])))
		) {
			index += 1;
		}
		if (
			wrapper === "timeout" &&
			index < words.length &&
			/^\d/.test(words[index])
		) {
			index += 1;
		}
	}

	if (index >= words.length) {
		return undefined;
	}

	const name = normalizeCommandName(words[index]);
	const args = words.slice(index + 1);

	if (name === "tee") {
		// `| tee /tmp/log` is a documented way to capture output; only file
		// arguments outside tmp modify tracked state.
		const fileArgs = args.filter((arg) => arg !== "--" && !arg.startsWith("-"));
		if (fileArgs.some((arg) => !isTmpPath(arg))) {
			return "`tee`";
		}
		return undefined;
	}

	if (FILE_MUTATING_COMMANDS.has(name)) {
		return `\`${name}\``;
	}

	if (name === "sed" || name === "gsed") {
		if (
			hasCombinedShortFlag(args, "i") ||
			args.some((arg) => arg.startsWith("--in-place"))
		) {
			return "`sed -i` (in-place edit)";
		}
		return undefined;
	}

	if (name === "perl") {
		if (hasCombinedShortFlag(args, "i")) {
			return "`perl -i` (in-place edit)";
		}
		return undefined;
	}

	if (name === "awk" || name === "gawk" || name === "nawk" || name === "mawk") {
		for (let cursor = 0; cursor < args.length; cursor += 1) {
			const arg = args[cursor];
			if (
				(arg === "-i" && args[cursor + 1]?.includes("inplace")) ||
				(arg.startsWith("-i") && arg.includes("inplace")) ||
				(arg.startsWith("--include") && arg.includes("inplace")) ||
				(arg === "--include" && args[cursor + 1]?.includes("inplace"))
			) {
				return "`awk -i inplace` (in-place edit)";
			}
		}
		return undefined;
	}

	if (name === "sort") {
		if (
			args.some(
				(arg) =>
					arg === "-o" || arg.startsWith("-o") || arg.startsWith("--output"),
			)
		) {
			return "`sort -o` (writes a file)";
		}
		return undefined;
	}

	if (name === "git") {
		return checkGitCommand(args);
	}

	if (name === "find") {
		return checkFindCommand(args, depth);
	}

	if (NODE_PACKAGE_MANAGERS.has(name)) {
		const subcommand = findFirstPositionalArg(args)?.toLowerCase();
		if (subcommand && NODE_PM_MUTATING_SUBCOMMANDS.has(subcommand)) {
			return `\`${name} ${subcommand}\``;
		}
		// Bare `yarn` runs an install.
		if (name === "yarn" && args.length === 0) {
			return "`yarn` (install)";
		}
		return undefined;
	}

	if (PYTHON_PACKAGE_MANAGERS.has(name)) {
		const subcommand = findFirstPositionalArg(args)?.toLowerCase();
		if (subcommand && PYTHON_PM_MUTATING_SUBCOMMANDS.has(subcommand)) {
			return `\`${name} ${subcommand}\``;
		}
		return undefined;
	}

	if (name === "cargo") {
		const subcommand = findFirstPositionalArg(args)?.toLowerCase();
		if (subcommand && CARGO_MUTATING_SUBCOMMANDS.has(subcommand)) {
			return `\`cargo ${subcommand}\``;
		}
		return undefined;
	}

	if (SYSTEM_PACKAGE_MANAGERS.has(name)) {
		const subcommand = findFirstPositionalArg(args)?.toLowerCase();
		if (subcommand && SYSTEM_PM_MUTATING_SUBCOMMANDS.has(subcommand)) {
			return `\`${name} ${subcommand}\``;
		}
		return undefined;
	}

	if (POSIX_SHELLS.has(name)) {
		const flagIndex = args.findIndex((arg) => arg === "-c");
		const nested = flagIndex !== -1 ? args[flagIndex + 1] : undefined;
		if (nested) {
			return scanCommandString(nested, depth + 1);
		}
		return undefined;
	}

	if (POWERSHELLS.has(name)) {
		const flagIndex = args.findIndex(
			(arg) => arg.toLowerCase() === "-command" || arg.toLowerCase() === "-c",
		);
		const nested = flagIndex !== -1 ? args[flagIndex + 1] : undefined;
		if (nested) {
			return scanCommandString(nested, depth + 1);
		}
		return undefined;
	}

	if (name === "cmd") {
		const flagIndex = args.findIndex((arg) => arg.toLowerCase() === "/c");
		const nested = flagIndex !== -1 ? args.slice(flagIndex + 1).join(" ") : "";
		if (nested) {
			return scanCommandString(nested, depth + 1);
		}
		return undefined;
	}

	if (name === "eval") {
		return (
			checkWords(args, depth + 1) ??
			scanCommandString(args.join(" "), depth + 1)
		);
	}

	return undefined;
}

function scanCommandString(command: string, depth: number): string | undefined {
	if (depth > MAX_NESTED_COMMAND_DEPTH) {
		return undefined;
	}
	for (const segment of tokenizeSegments(command, depth)) {
		for (const token of segment) {
			if (
				token.kind === "write-redirect" &&
				!isAllowedRedirectTarget(token.target)
			) {
				return `output redirection (\`> ${token.target}\`)`;
			}
		}
		const words = segment
			.filter((token) => token.kind === "word")
			.map((token) => token.value);
		const blocked = checkWords(words, depth);
		if (blocked) {
			return blocked;
		}
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
	if (typeof command === "string") {
		return scanCommandString(command, 0);
	}
	return checkWords([command.command, ...(command.args ?? [])], 0);
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
