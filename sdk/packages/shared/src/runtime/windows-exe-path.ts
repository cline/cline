/**
 * Windows' documented opt-out from resolving bare program names through the
 * current directory. Its presence is what matters, not its value.
 */
export const NO_DEFAULT_CURRENT_DIRECTORY_IN_EXE_PATH_ENV =
	"NoDefaultCurrentDirectoryInExePath";

/**
 * Stop Windows from resolving bare program names through the child's working
 * directory.
 *
 * When `child_process.spawn("rg", ...)` runs on Windows, libuv resolves the
 * bare name by looking in the child's cwd before walking PATH (it gates that
 * step on `NeedCurrentDirectoryForExePathW`, which reads this variable from
 * the spawning process). Cline spawns `rg`, `git`, `powershell` and
 * model-named programs with the user's workspace as cwd, so a repo that ships
 * an `rg.exe` would get it executed, with the user's privileges, the moment
 * the workspace opened. Bun's spawn (1.4+) honors the same variable, as do
 * cmd.exe and the C runtime, so children inherit the protection too.
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
	env[NO_DEFAULT_CURRENT_DIRECTORY_IN_EXE_PATH_ENV] = "1";
}
