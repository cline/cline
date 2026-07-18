import { type SpawnOptions, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { win32 } from "node:path";

export interface SkillCommandIo {
	writeln: (text?: string) => void;
	writeErr: (text: string) => void;
}

// `cline skill` is a thin wrapper around the open skills CLI
// (https://www.npmjs.com/package/skills). We run it through `npx` so users
// don't need a separate global install. Pin the version here if we ever need to
// lock behavior to a known-good release.
const SKILLS_PACKAGE = "skills@latest";

// Subcommands that write skill files into an agent's skills directory. For a
// `cline skill` command we default these to Cline unless the user picked their
// own agent. `use` is intentionally excluded: without --agent it prints the
// generated prompt to stdout, whereas adding --agent would launch that agent
// interactively instead — not what someone scoping to Cline would expect.
const CLINE_SCOPED_SUBCOMMANDS = new Set([
	"add",
	"install",
	"i",
	"update",
	"remove",
	"rm",
	"r",
	"uninstall",
]);

const SKILLS_SUBCOMMAND_ALIASES = new Map([
	["install", "add"],
	["uninstall", "remove"],
]);

export interface NpxInvocation {
	command: string;
	args: string[];
}

interface ResolveNpxInvocationOptions {
	platform?: NodeJS.Platform;
	env?: NodeJS.ProcessEnv;
	execPath?: string;
	fileExists?: (path: string) => boolean;
}

function normalizeWindowsPathEntry(value: string): string {
	const trimmed = value.trim();
	if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

function uniqueWindowsPaths(values: readonly string[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const value of values) {
		const normalized = normalizeWindowsPathEntry(value);
		if (!normalized) continue;
		const key = normalized.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		result.push(normalized);
	}
	return result;
}

/**
 * Resolve a shell-free npx invocation.
 *
 * Windows cannot execute the usual `npx.cmd` launcher directly with spawn(),
 * while enabling `shell` would concatenate untrusted arguments into a command
 * string. Prefer an executable npx shim when available, otherwise run npm's
 * npx-cli.js with node.exe so every user argument remains a distinct argv item.
 */
export function resolveNpxInvocation(
	npxArgs: readonly string[],
	options: ResolveNpxInvocationOptions = {},
): NpxInvocation | undefined {
	const platform = options.platform ?? process.platform;
	if (platform !== "win32") {
		return { command: "npx", args: [...npxArgs] };
	}

	const env = options.env ?? process.env;
	const execPath = options.execPath ?? process.execPath;
	const fileExists = options.fileExists ?? existsSync;
	const pathEntries = (env.Path ?? env.PATH ?? "").split(";");
	const execDirectory =
		win32.basename(execPath).toLowerCase() === "node.exe"
			? win32.dirname(execPath)
			: undefined;
	const directories = uniqueWindowsPaths([
		...(execDirectory ? [execDirectory] : []),
		...pathEntries,
	]);
	const nodeCandidates = uniqueWindowsPaths([
		...(execDirectory ? [execPath] : []),
		...directories.map((directory) => win32.join(directory, "node.exe")),
	]);
	const nodePath = nodeCandidates.find(fileExists);

	const npmExecPath = env.npm_execpath?.trim();
	if (
		nodePath &&
		npmExecPath &&
		win32.basename(npmExecPath).toLowerCase() === "npm-cli.js"
	) {
		const npxCliPath = win32.join(win32.dirname(npmExecPath), "npx-cli.js");
		if (fileExists(npxCliPath)) {
			return {
				command: nodePath,
				args: [npxCliPath, ...npxArgs],
			};
		}
	}

	// Preserve PATH order: a safe launcher next to an earlier PATH entry wins
	// over a different launcher found in a later directory.
	for (const directory of directories) {
		const executable = win32.join(directory, "npx.exe");
		if (fileExists(executable)) {
			return { command: executable, args: [...npxArgs] };
		}
		if (nodePath) {
			const npxCliPath = win32.join(
				directory,
				"node_modules",
				"npm",
				"bin",
				"npx-cli.js",
			);
			if (fileExists(npxCliPath)) {
				return {
					command: nodePath,
					args: [npxCliPath, ...npxArgs],
				};
			}
		}
	}

	return undefined;
}

function hasAgentFlag(args: readonly string[]): boolean {
	return args.some(
		(arg) => arg === "-a" || arg === "--agent" || arg.startsWith("--agent="),
	);
}

function optionConsumesNextValue(arg: string): boolean {
	return arg === "-a" || arg === "--agent";
}

function findSubcommandIndex(args: readonly string[]): number {
	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (arg.startsWith("-")) {
			if (optionConsumesNextValue(arg)) {
				index++;
			}
			continue;
		}
		return index;
	}
	return -1;
}

function findSubcommand(args: readonly string[]): string | undefined {
	const index = findSubcommandIndex(args);
	return index >= 0 ? args[index] : undefined;
}

function normalizeSkillsSubcommandAliases(args: string[]): void {
	const index = findSubcommandIndex(args);
	if (index < 0) return;
	const alias = SKILLS_SUBCOMMAND_ALIASES.get(args[index]);
	if (alias) {
		args[index] = alias;
	}
}

/**
 * Build the argument list passed to `npx`, injecting `--agent cline` for
 * install-style subcommands unless the user already targeted an agent.
 */
export function buildSkillsArgs(userArgs: readonly string[]): string[] {
	const args = [...userArgs];
	const subcommand = findSubcommand(args);
	normalizeSkillsSubcommandAliases(args);
	if (
		subcommand &&
		CLINE_SCOPED_SUBCOMMANDS.has(subcommand) &&
		!hasAgentFlag(args)
	) {
		args.push("--agent", "cline");
	}
	return ["-y", SKILLS_PACKAGE, ...args];
}

function resolveExitCode(
	code: number | null,
	signal: NodeJS.Signals | null,
): number {
	if (code !== null) {
		return code;
	}
	switch (signal) {
		case "SIGINT":
			return 130;
		case "SIGTERM":
			return 143;
		default:
			return 1;
	}
}

/**
 * Forward all arguments to the open skills CLI via `npx skills`.
 *
 * Returns the child process exit code, or 1 if npx is unavailable or fails to
 * spawn. stdio is inherited so the skills CLI's interactive prompts and output
 * pass straight through to the user's terminal.
 */
export async function runSkillCommand(
	userArgs: readonly string[],
	io: SkillCommandIo,
): Promise<number> {
	const args = buildSkillsArgs(userArgs);
	const invocation = resolveNpxInvocation(args);
	if (!invocation) {
		io.writeErr(
			'npx was not found. Install Node.js (which includes npx) to use "cline skill".',
		);
		return 1;
	}
	const options: SpawnOptions = {
		stdio: "inherit",
		env: process.env,
		// Prevent a console window from flashing on Windows.
		windowsHide: true,
		// Never route forwarded skill arguments through a command shell.
		shell: false,
	};

	return new Promise<number>((resolve) => {
		const child = spawn(invocation.command, invocation.args, options);

		const forward = (signal: NodeJS.Signals) => {
			child.kill(signal);
		};
		const handleSigint = () => forward("SIGINT");
		const handleSigterm = () => forward("SIGTERM");
		process.on("SIGINT", handleSigint);
		process.on("SIGTERM", handleSigterm);
		const cleanup = () => {
			process.off("SIGINT", handleSigint);
			process.off("SIGTERM", handleSigterm);
		};

		child.once("error", (error: NodeJS.ErrnoException) => {
			cleanup();
			if (error.code === "ENOENT") {
				io.writeErr(
					'npx was not found. Install Node.js (which includes npx) to use "cline skill".',
				);
			} else {
				io.writeErr(`Failed to run npx ${SKILLS_PACKAGE}: ${error.message}`);
			}
			resolve(1);
		});
		child.once("close", (code, signal) => {
			cleanup();
			resolve(resolveExitCode(code, signal));
		});
	});
}
