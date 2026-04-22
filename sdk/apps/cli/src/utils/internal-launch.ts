import { existsSync } from "node:fs";
import { isAbsolute, resolve as resolvePath } from "node:path";
import {
	augmentNodeCommandForDebug,
	type ClineDebugRole,
} from "@clinebot/shared";

export interface ResolveCliLaunchSpecOptions {
	execPath?: string;
	argv?: string[];
	execArgv?: string[];
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	debugRole?: ClineDebugRole;
}

export interface CliLaunchSpec {
	launcher: string;
	childArgsPrefix: string[];
	identityPath: string;
	mode: "compiled" | "source";
}

function normalizeEntryArg(
	entryArg: string | undefined,
	cwd: string,
): string | undefined {
	const trimmed = entryArg?.trim();
	if (!trimmed || trimmed.startsWith("/$bunfs/")) {
		return undefined;
	}
	return isAbsolute(trimmed) ? trimmed : resolvePath(cwd, trimmed);
}

export function resolveCliLaunchSpec(
	options: ResolveCliLaunchSpecOptions = {},
): CliLaunchSpec | undefined {
	const execPath = options.execPath?.trim() || process.execPath;
	const argv = options.argv ?? process.argv;
	const execArgv = options.execArgv ?? process.execArgv;
	const cwd = options.cwd ?? process.cwd();
	const env = options.env ?? process.env;
	const debugRole = options.debugRole;
	if (!execPath) {
		return undefined;
	}

	const resolvedEntry = normalizeEntryArg(argv[1], cwd);
	if (resolvedEntry && existsSync(resolvedEntry)) {
		const conditionsArg = execArgv.find((arg) =>
			arg.startsWith("--conditions="),
		);
		const command = augmentNodeCommandForDebug(
			[execPath, ...(conditionsArg ? [conditionsArg] : []), resolvedEntry],
			{ env, execArgv, debugRole },
		);
		return {
			launcher: command[0] ?? execPath,
			childArgsPrefix: command.slice(1),
			identityPath: resolvedEntry,
			mode: "source",
		};
	}

	const command = augmentNodeCommandForDebug([execPath], {
		env,
		execArgv,
		debugRole,
	});
	return {
		launcher: command[0] ?? execPath,
		childArgsPrefix: command.slice(1),
		identityPath: execPath,
		mode: "compiled",
	};
}

export function buildCliSubcommandCommand(
	subcommand: string,
	args: string[] = [],
	options: ResolveCliLaunchSpecOptions = {},
): { launcher: string; childArgs: string[] } | undefined {
	const spec = resolveCliLaunchSpec(options);
	return spec
		? {
				launcher: spec.launcher,
				childArgs: [...spec.childArgsPrefix, subcommand, ...args],
			}
		: undefined;
}
