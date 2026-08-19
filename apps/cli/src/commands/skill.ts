import { type SpawnOptions, spawn } from "node:child_process";

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
	const isWindows = process.platform === "win32";
	const options: SpawnOptions = {
		stdio: "inherit",
		env: process.env,
		// Prevent a console window from flashing on Windows.
		windowsHide: true,
		...(isWindows ? { shell: true } : {}),
	};

	return new Promise<number>((resolve) => {
		const child = spawn("npx", args, options);

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
