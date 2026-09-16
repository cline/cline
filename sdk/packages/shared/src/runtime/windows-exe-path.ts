/**
 * Windows' documented opt-out from resolving bare program names through the
 * current directory. Its presence is what matters, not its value.
 */
export const NO_DEFAULT_CURRENT_DIRECTORY_IN_EXE_PATH_ENV =
	"NoDefaultCurrentDirectoryInExePath";

/**
 * The variable's value in the environment this process inherited, latched by
 * {@link disableCurrentDirectoryExecutableSearch} so children can be handed
 * the state they would have seen had Cline not hardened itself.
 */
let inherited: { value: string | undefined } | undefined;

/**
 * Stop Windows from resolving bare program names through the child's working
 * directory.
 *
 * When `child_process.spawn("rg", ...)` runs on Windows, libuv resolves the
 * bare name by looking in the child's cwd before walking PATH. It gates that
 * step on `NeedCurrentDirectoryForExePathW`, which reads this variable from
 * the spawning process's own environment, not the child's. Cline spawns `rg`,
 * `git`, `powershell` and model-named programs with the user's workspace as
 * cwd, so a repo that ships an `rg.exe` would get it executed, with the user's
 * privileges, the moment the workspace opened. Bun's spawn (1.4+) reads the
 * same variable.
 *
 * Call once at process startup, from the main thread (a worker thread's
 * `process.env` is a copy that native code never sees), before anything can
 * spawn. No-op off Windows.
 */
export function disableCurrentDirectoryExecutableSearch(
	options: {
		env?: Record<string, string | undefined>;
		platform?: NodeJS.Platform;
	} = {},
): void {
	const { env = process.env, platform = process.platform } = options;
	if (platform !== "win32") return;
	inherited ??= { value: env[NO_DEFAULT_CURRENT_DIRECTORY_IN_EXE_PATH_ENV] };
	env[NO_DEFAULT_CURRENT_DIRECTORY_IN_EXE_PATH_ENV] = "1";
}

/**
 * Build a child environment that carries the variable exactly as this process
 * inherited it: absent if it was absent, the user's own value if they set it.
 *
 * The protection only needs the variable in the spawning process, but it is
 * also honored by cmd.exe, libuv-based children, Go and Bun 1.4+, so letting
 * user-facing children (shell commands, hooks, MCP servers, plugin sandboxes)
 * inherit Cline's setting would silently change how their own bare program
 * names resolve. Returns `env` untouched when
 * {@link disableCurrentDirectoryExecutableSearch} has not run in this process.
 */
export function withInheritedExecutableSearch(
	env: Record<string, string | undefined>,
): Record<string, string | undefined> {
	if (!inherited) return env;
	const child = { ...env };
	if (inherited.value === undefined) {
		delete child[NO_DEFAULT_CURRENT_DIRECTORY_IN_EXE_PATH_ENV];
	} else {
		child[NO_DEFAULT_CURRENT_DIRECTORY_IN_EXE_PATH_ENV] = inherited.value;
	}
	return child;
}
