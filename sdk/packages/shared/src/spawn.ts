import { existsSync, readFileSync } from "node:fs";
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
	/** Reads a `.cmd` shim's contents; injectable for tests. */
	readTextFile?: (path: string) => string;
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

function resolveWindowsNodePath(
	env: NodeJS.ProcessEnv,
	execPath: string,
	fileExists: (path: string) => boolean,
): string | undefined {
	// The running process is the most trustworthy node.exe when it is one.
	const execIsNode = win32.basename(execPath).toLowerCase() === "node.exe";
	const nodeCandidates = uniqueWindowsPaths([
		...(execIsNode ? [execPath] : []),
		...getWindowsPathDirectories(env, execPath).map((directory) =>
			win32.join(directory, "node.exe"),
		),
	]);
	return nodeCandidates.find(fileExists);
}

/**
 * Prefer `directory\node.exe` when pairing Node with a script or shim from that
 * directory (matching npm's `%~dp0\node.exe` semantics). Fall back to a PATH /
 * execPath resolution only when no local node.exe exists.
 */
function resolveNodeBeside(
	directory: string,
	fallback: string | undefined,
	fileExists: (path: string) => boolean,
): string | undefined {
	const localNode = win32.join(directory, "node.exe");
	return fileExists(localNode) ? localNode : fallback;
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
	const directories = getWindowsPathDirectories(env, execPath);
	const nodePath = resolveWindowsNodePath(env, execPath, fileExists);

	const npmExecPath = env.npm_execpath?.trim();
	if (
		npmExecPath &&
		win32.basename(npmExecPath).toLowerCase() === "npm-cli.js"
	) {
		const npmBinDir = win32.dirname(npmExecPath);
		const npxCliPath = win32.join(npmBinDir, "npx-cli.js");
		if (fileExists(npxCliPath)) {
			// npm-cli.js lives at <prefix>\node_modules\npm\bin\; pair with
			// <prefix>\node.exe when present rather than an unrelated PATH hit.
			const npmPrefix = win32.resolve(npmBinDir, "..", "..", "..");
			const command = resolveNodeBeside(npmPrefix, nodePath, fileExists);
			if (command) {
				return {
					command,
					args: [npxCliPath, ...npxArgs],
				};
			}
		}
	}

	// Preserve PATH order: a safe launcher next to an earlier PATH entry wins
	// over a different launcher found in a later directory.
	for (const directory of directories) {
		const executable = win32.join(directory, "npx.exe");
		if (fileExists(executable)) {
			return { command: executable, args: [...npxArgs] };
		}
		const npxCliPath = win32.join(
			directory,
			"node_modules",
			"npm",
			"bin",
			"npx-cli.js",
		);
		if (fileExists(npxCliPath)) {
			const command = resolveNodeBeside(directory, nodePath, fileExists);
			if (command) {
				return {
					command,
					args: [npxCliPath, ...npxArgs],
				};
			}
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

	// An explicit path: only directly spawnable if its extension can run
	// without a shell. A `.cmd`/`.bat` at an explicit path still needs cmd.exe,
	// so return undefined and let the caller rewrite the shim or fall back to a
	// shell. An extensionless explicit path is trusted as a real executable.
	if (command.includes("/") || command.includes("\\")) {
		if (!fileExists(command)) return undefined;
		const explicitExtension = win32.extname(command).toLowerCase();
		if (
			explicitExtension &&
			!DIRECT_SPAWN_EXTENSIONS.includes(explicitExtension)
		) {
			return undefined;
		}
		return command;
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

function findWindowsCmdShim(
	command: string,
	env: NodeJS.ProcessEnv,
	execPath: string,
	fileExists: (path: string) => boolean,
): string | undefined {
	if (command.includes("/") || command.includes("\\")) {
		return command.toLowerCase().endsWith(".cmd") && fileExists(command)
			? command
			: undefined;
	}
	if (win32.extname(command)) return undefined;
	for (const directory of getWindowsPathDirectories(env, execPath)) {
		const candidate = win32.join(directory, `${command}.cmd`);
		if (fileExists(candidate)) return candidate;
	}
	return undefined;
}

// npm bins are JavaScript run through node, so the wrapped script is only
// ever extensionless (a shebang bin) or a JS file. Any other extension
// (`.exe`, `.cmd`, `.ps1`, ...) means a native/non-npm wrapper — leave it to
// the caller's shell fallback. It also rejects the `"%~dp0\node.exe"`
// self-reference a shim can contain.
const NODE_SCRIPT_EXTENSIONS = [".js", ".cjs", ".mjs"];

/**
 * Rewrite an npm-generated `.cmd` shim to the `node <script>` invocation it runs
 * internally, so we can launch its target directly instead of through cmd.exe.
 *
 * npm's shims (both the `npx.cmd` and the `cline.cmd`/`node-gyp`-style layouts)
 * ultimately execute `"<node>" "<%~dp0%-relative script>" %*`. We parse the shim
 * to recover that `%~dp0`-relative script, resolve it against the shim's own
 * directory (mirroring `%~dp0`), and pair it with a real `node.exe`. Returns
 * `undefined` for any shim that does not match this shape.
 */
function resolveCmdShimInvocation(
	shimPath: string,
	fallbackNodePath: string | undefined,
	extraArgs: readonly string[],
	fileExists: (path: string) => boolean,
	readTextFile: (path: string) => string,
): ShellFreeInvocation | undefined {
	let contents: string;
	try {
		contents = readTextFile(shimPath);
	} catch {
		return undefined;
	}
	const shimDir = win32.dirname(shimPath);
	// Match npm shim semantics: prefer `%~dp0\node.exe` beside the shim, then
	// fall back to PATH / execPath resolution.
	const nodePath = resolveNodeBeside(shimDir, fallbackNodePath, fileExists);
	if (!nodePath) return undefined;
	// Match the script argument in `... "%~dp0\<script>" %*` or the
	// `"%dp0%\<script>"` variable-indirection form both npm layouts emit, and
	// keep the first existing target node can run.
	const scriptPattern = /"%~?dp0%?[\\/]+([^"]+?)"\s+%\*/g;
	let match: RegExpExecArray | null = scriptPattern.exec(contents);
	while (match) {
		const relative = match[1].replace(/[\\/]+/g, win32.sep);
		const extension = win32.extname(relative).toLowerCase();
		if (!extension || NODE_SCRIPT_EXTENSIONS.includes(extension)) {
			const scriptPath = win32.join(shimDir, relative);
			if (fileExists(scriptPath)) {
				return { command: nodePath, args: [scriptPath, ...extraArgs] };
			}
		}
		match = scriptPattern.exec(contents);
	}
	return undefined;
}

/**
 * Resolve any `(command, args)` pair to a shell-free invocation.
 *
 * `npx` is special-cased to npm's Node CLI resolution. Other commands resolve to
 * a directly-spawnable executable; failing that, an npm-generated `.cmd` shim is
 * rewritten to the `node <script>` invocation it wraps so it too runs without a
 * shell. On non-Windows platforms the pair passes through unchanged. Returns
 * `undefined` only when the command can be launched exclusively through a shell.
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
	if (executable) {
		return { command: executable, args: [...args] };
	}
	// No directly-spawnable .exe: if the command is an npm-generated .cmd shim,
	// run the `node <script>` invocation it wraps so it still avoids cmd.exe.
	const env = options.env ?? process.env;
	const execPath = options.execPath ?? process.execPath;
	const fileExists = options.fileExists ?? existsSync;
	const readTextFile = options.readTextFile ?? readFileSyncUtf8;
	const shimPath = findWindowsCmdShim(command, env, execPath, fileExists);
	if (!shimPath) return undefined;
	const nodePath = resolveWindowsNodePath(env, execPath, fileExists);
	return resolveCmdShimInvocation(
		shimPath,
		nodePath,
		args,
		fileExists,
		readTextFile,
	);
}

function readFileSyncUtf8(path: string): string {
	return readFileSync(path, "utf8");
}
