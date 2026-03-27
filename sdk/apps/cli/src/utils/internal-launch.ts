import { existsSync } from "node:fs";
import { isAbsolute, resolve as resolvePath } from "node:path";

export const CLINE_INTERNAL_ROLE_ENV = "CLINE_INTERNAL_ROLE";
export const CLINE_INTERNAL_DEPTH_ENV = "CLINE_INTERNAL_DEPTH";

export type CliInternalRole = "hook" | "hook-worker";

export interface ResolveCliLaunchSpecOptions {
	execPath?: string;
	argv?: string[];
	execArgv?: string[];
	cwd?: string;
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
	if (!execPath) {
		return undefined;
	}

	const resolvedEntry = normalizeEntryArg(argv[1], cwd);
	if (resolvedEntry && existsSync(resolvedEntry)) {
		const conditionsArg = execArgv.find((arg) =>
			arg.startsWith("--conditions="),
		);
		return {
			launcher: execPath,
			childArgsPrefix: [
				...(conditionsArg ? [conditionsArg] : []),
				resolvedEntry,
			],
			identityPath: resolvedEntry,
			mode: "source",
		};
	}

	return {
		launcher: execPath,
		childArgsPrefix: [],
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
	if (!spec) {
		return undefined;
	}
	return {
		launcher: spec.launcher,
		childArgs: [...spec.childArgsPrefix, subcommand, ...args],
	};
}

export function buildInternalCliEnv(
	role: CliInternalRole,
	env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
	const currentDepth = Number.parseInt(
		env[CLINE_INTERNAL_DEPTH_ENV] ?? "0",
		10,
	);
	const nextDepth = Number.isFinite(currentDepth) ? currentDepth + 1 : 1;
	return {
		...env,
		[CLINE_INTERNAL_ROLE_ENV]: role,
		[CLINE_INTERNAL_DEPTH_ENV]: String(nextDepth),
	};
}

export function shouldDisableInternalRuntimeHooks(
	env: NodeJS.ProcessEnv = process.env,
): boolean {
	const role = env[CLINE_INTERNAL_ROLE_ENV]?.trim();
	return role === "hook" || role === "hook-worker";
}

export function getInternalLaunchViolation(
	cliArgs: string[],
	env: NodeJS.ProcessEnv = process.env,
): string | undefined {
	const expectedRole = env[CLINE_INTERNAL_ROLE_ENV]?.trim();
	if (!expectedRole) {
		return undefined;
	}

	const depthValue = Number.parseInt(env[CLINE_INTERNAL_DEPTH_ENV] ?? "0", 10);
	const depth = Number.isFinite(depthValue) ? depthValue : 0;
	if (depth > 1) {
		return `refusing nested internal CLI launch for role "${expectedRole}" at depth ${depth}`;
	}

	const receivedSubcommand = cliArgs[0]?.trim();
	if (receivedSubcommand !== expectedRole) {
		return `internal CLI role "${expectedRole}" expected subcommand "${expectedRole}" but received ${receivedSubcommand ? `"${receivedSubcommand}"` : "none"}`;
	}

	return undefined;
}
