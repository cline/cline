/**
 * Microsoft's opt-out for the legacy "current directory first" executable
 * search. `NeedCurrentDirectoryForExePath` reports the current directory as
 * unnecessary whenever this variable is defined, and libuv, cmd.exe, Bun and
 * Go's `exec.LookPath` all consult it.
 */
const NO_DEFAULT_CURRENT_DIRECTORY_IN_EXE_PATH =
	"NoDefaultCurrentDirectoryInExePath";

/**
 * Stop Windows from resolving a bare program name out of the working directory
 * before PATH.
 *
 * libuv's `search_path()` probes the child's working directory before every
 * PATH entry unless this variable is defined in the spawning process, so on
 * Windows `spawn("rg", …, { cwd })` runs `${cwd}\rg.exe` when one exists. Cline
 * spawns `rg`, `git` and the user's shell by bare name with the open repository
 * as the working directory, and the file index spawns `rg` as soon as a
 * workspace opens, so a repository carrying an `rg.exe` would execute it with
 * the user's privileges before anything is approved.
 *
 * Call this from a process entry point, before anything can spawn. One call
 * covers every spawn the process makes, including those inside dependencies:
 * the lookup reads the OS environment block rather than any per-thread copy,
 * so worker threads are covered too. Child processes inherit the variable and
 * apply the same rule to their own lookups.
 *
 * The value has to be non-empty. `NeedCurrentDirectoryForExePath` reads the
 * variable into a one-character buffer and treats "no characters returned" as
 * "not defined", so an empty value would silently leave the search enabled.
 */
export function excludeCurrentDirectoryFromExecutableSearch(): void {
	if (process.platform !== "win32") {
		return;
	}
	process.env[NO_DEFAULT_CURRENT_DIRECTORY_IN_EXE_PATH] = "1";
}
