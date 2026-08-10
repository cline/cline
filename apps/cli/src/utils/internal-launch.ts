import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { HUB_VERSION } from "@cline/hub";
import {
	augmentNodeCommandForDebug,
	type ClineDebugRole,
	type HubDaemonLaunchSpec,
} from "@cline/shared";

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

export function resolveCliHubDaemonLaunchSpec(
	options: ResolveCliLaunchSpecOptions = {},
): HubDaemonLaunchSpec | undefined {
	const cli = resolveCliLaunchSpec(options);
	if (!cli) return undefined;
	if (cli.mode === "compiled") {
		const extension = process.platform === "win32" ? ".exe" : "";
		return {
			launcher: join(dirname(cli.identityPath), `cline-hub${extension}`),
			argsPrefix: [],
			cwd: options.cwd ?? process.cwd(),
			version: HUB_VERSION,
		};
	}
	const execPath = options.execPath?.trim() || process.execPath;
	if (!execPath) return undefined;
	const conditionsArg = (options.execArgv ?? process.execArgv).find((arg) =>
		arg.startsWith("--conditions="),
	);
	return {
		launcher: execPath,
		argsPrefix: [
			...(conditionsArg ? [conditionsArg] : ["--conditions=development"]),
			fileURLToPath(
				new URL(
					"../../../../sdk/packages/hub-daemon/src/entry.ts",
					import.meta.url,
				),
			),
		],
		cwd: options.cwd ?? process.cwd(),
		version: HUB_VERSION,
	};
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
