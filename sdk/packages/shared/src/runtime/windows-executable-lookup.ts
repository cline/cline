/**
 * Windows resolves a program spawned by bare name — no `\`, `/` or `:` — by
 * looking in the child's working directory before it walks PATH. That is the
 * convention `CreateProcess` and cmd.exe follow, and libuv (so Node) mirrors
 * it in `uv_spawn`; PowerShell alone resolves bare names through PATH only.
 * For Cline the working directory is the user's workspace, so a same-named
 * file committed to a repo would run in place of the real shell, ripgrep or
 * git the moment core spawns them.
 *
 * `NoDefaultCurrentDirectoryInExePath` is the operating system's switch for
 * that step: while the variable exists in the spawning process,
 * `NeedCurrentDirectoryForExePath` reports false and the working directory is
 * skipped. libuv consults it on every spawn (since 1.48), Bun does from 1.4.0,
 * and cmd.exe honors it for its own lookups. Only existence matters, not the
 * value.
 */
export const NO_DEFAULT_CURRENT_DIRECTORY_IN_EXE_PATH =
	"NoDefaultCurrentDirectoryInExePath";

export interface HardenWindowsExecutableLookupOptions {
	/** Defaults to the current platform; the switch means nothing elsewhere. */
	platform?: NodeJS.Platform;
	/**
	 * Defaults to `process.env`, which Node and Bun write through to the
	 * process's environment block, where libuv reads it.
	 */
	env?: Record<string, string | undefined>;
}

/**
 * Turn off the working-directory step of executable lookup for this process.
 *
 * Call it at every host entry point before anything spawns into the
 * workspace. The runtime bootstrap calls it as well, so an embedder that
 * skips the entry points is covered once it builds a runtime. The effect is
 * process-wide by nature: every later spawn from this process resolves bare
 * names through PATH only, and children inherit the variable unless the
 * caller removes it from their environment — the shell executor does, so a
 * user's cmd.exe keeps the behavior of their own console.
 *
 * Returns true on Windows once the variable is present, false on every other
 * platform. An existing value, in any spelling, is left alone.
 */
export function hardenWindowsExecutableLookup(
	options: HardenWindowsExecutableLookupOptions = {},
): boolean {
	const platform = options.platform ?? process.platform;
	if (platform !== "win32") return false;
	const env = options.env ?? process.env;
	if (!hasVariable(env, NO_DEFAULT_CURRENT_DIRECTORY_IN_EXE_PATH)) {
		env[NO_DEFAULT_CURRENT_DIRECTORY_IN_EXE_PATH] = "1";
	}
	return true;
}

/** Windows environment names are case-insensitive; a plain object's keys are not. */
function hasVariable(
	env: Readonly<Record<string, string | undefined>>,
	name: string,
): boolean {
	const wanted = name.toLowerCase();
	return Object.entries(env).some(
		([key, value]) => key.toLowerCase() === wanted && value !== undefined,
	);
}
