import { existsSync } from "node:fs";
import { win32 } from "node:path";

// Shell-free process launching for Windows.
//
// On Windows the usual launchers (`npx`, `npm`) ship as `.cmd` batch shims that
// `spawn()` cannot execute directly, which historically pushed callers to
// `shell: true`. But `shell: true` concatenates the args array into a single
// command string that `cmd.exe` re-parses, so a legitimate argument containing
// a shell metacharacter (`&`, `|`, `<`, `>`) is reinterpreted as redirection or
// a command separator. Real marketplace entries hit this: an npm semver range
// like `mongodb-mcp-server@<3` or `@toolbox-sdk/server@>=1.1.0` is mangled by
// the shell instead of reaching the child as one literal argv element.
//
// The resolvers below run npm's Node CLI (`npx-cli.js`) through `node.exe`, or a
// native `.exe` shim, so every argument stays a distinct argv item and no shell
// is involved. On non-Windows platforms there is no `.cmd` problem and the
// command runs unchanged.
//
// The npx resolution logic is ported from the (unmerged) work in
// https://github.com/cline/cline/pull/12386 by @yoyo406.

export interface ShellFreeInvocation {
	command: string;
	args: string[];
}

export interface ResolveWindowsSpawnOptions {
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

function getWindowsPathDirectories(
	env: NodeJS.ProcessEnv,
	execPath: string,
): string[] {
	const pathEntries = (env.Path ?? env.PATH ?? "").split(";");
	const execDirectory =
		win32.basename(execPath).toLowerCase() === "node.exe"
			? win32.dirname(execPath)
			: undefined;
	return uniqueWindowsPaths([
		...(execDirectory ? [execDirectory] : []),
		...pathEntries,
	]);
}

/**
 * Resolve a shell-free `npx` invocation.
 *
 * Prefers a native `npx.exe` shim when available, otherwise runs npm's
 * `npx-cli.js` through `node.exe` so every forwarded argument remains a distinct
 * argv item. Returns `undefined` when Windows only exposes an unsafe `.cmd`
 * shim (which would require a shell) — callers should surface a clear error
 * rather than fall back to a shell.
 *
 * Ported from https://github.com/cline/cline/pull/12386 by @yoyo406.
 */
export function resolveNpxInvocation(
	npxArgs: readonly string[],
	options: ResolveWindowsSpawnOptions = {},
): ShellFreeInvocation | undefined {
	const platform = options.platform ?? process.platform;
	if (platform !== "win32") {
		return { command: "npx", args: [...npxArgs] };
	}

	const env = options.env ?? process.env;
	const execPath = options.execPath ?? process.execPath;
	const fileExists = options.fileExists ?? existsSync;
	const execDirectory =
		win32.basename(execPath).toLowerCase() === "node.exe"
			? win32.dirname(execPath)
			: undefined;
	const directories = getWindowsPathDirectories(env, execPath);
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
		if (!nodePath) continue;
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

	return undefined;
}

// PATHEXT entries whose executables run directly under spawn() without a shell.
// `.cmd`/`.bat` are intentionally excluded: batch shims require cmd.exe, which
// is exactly the shell we are avoiding.
const DIRECT_SPAWN_EXTENSIONS = [".exe", ".com"];

/**
 * Resolve a bare Windows command name to a directly-spawnable executable path.
 *
 * Searches PATH (and the running node's directory) for a `.exe`/`.com` matching
 * `command`, so the caller can spawn it with `shell: false` and pass arguments
 * as literal argv. Returns `undefined` when only a batch shim exists or nothing
 * matches; the command is returned unchanged when it is already an absolute or
 * extension-qualified path that exists.
 */
export function resolveWindowsExecutable(
	command: string,
	options: ResolveWindowsSpawnOptions = {},
): string | undefined {
	const env = options.env ?? process.env;
	const execPath = options.execPath ?? process.execPath;
	const fileExists = options.fileExists ?? existsSync;

	// Already a concrete path or extension-qualified: trust it as-is.
	if (command.includes("/") || command.includes("\\")) {
		return fileExists(command) ? command : undefined;
	}
	const extension = win32.extname(command).toLowerCase();
	if (extension) {
		if (DIRECT_SPAWN_EXTENSIONS.includes(extension)) {
			for (const directory of getWindowsPathDirectories(env, execPath)) {
				const candidate = win32.join(directory, command);
				if (fileExists(candidate)) return candidate;
			}
		}
		return undefined;
	}

	for (const directory of getWindowsPathDirectories(env, execPath)) {
		for (const candidateExtension of DIRECT_SPAWN_EXTENSIONS) {
			const candidate = win32.join(
				directory,
				`${command}${candidateExtension}`,
			);
			if (fileExists(candidate)) return candidate;
		}
	}
	return undefined;
}

/**
 * Resolve any `(command, args)` pair to a shell-free invocation.
 *
 * `npx` is special-cased to npm's Node CLI resolution; every other command is
 * resolved to a directly-spawnable executable. On non-Windows platforms the
 * pair passes through unchanged. Returns `undefined` when the command cannot be
 * launched without a shell, so callers must fail with a clear message rather
 * than fall back to `shell: true`.
 */
export function resolveShellFreeInvocation(
	command: string,
	args: readonly string[],
	options: ResolveWindowsSpawnOptions = {},
): ShellFreeInvocation | undefined {
	const platform = options.platform ?? process.platform;
	if (platform !== "win32") {
		return { command, args: [...args] };
	}
	if (command.toLowerCase() === "npx") {
		return resolveNpxInvocation(args, options);
	}
	const executable = resolveWindowsExecutable(command, options);
	return executable ? { command: executable, args: [...args] } : undefined;
}
