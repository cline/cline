import { win32 } from "node:path";

/**
 * Helpers for the environment and program paths the executor hands to
 * `child_process.spawn` on Windows.
 *
 * The lookup itself is hardened elsewhere: on Windows, libuv resolves a bare
 * program name by searching the child's working directory before PATH, which
 * PowerShell itself never does. `hardenWindowsExecutableLookup` in
 * `@cline/shared` sets the `NoDefaultCurrentDirectoryInExePath` switch for the
 * current process, and every host entry point and the runtime bootstrap call
 * it before anything spawns into the workspace. What remains here is making
 * sure the child environment says what the caller meant, and that the
 * executor's own helper programs are named by their fixed install paths.
 */

/**
 * Absolute path of a tool that ships directly in the Windows system
 * directory, such as `taskkill.exe`. The executor's own helpers use fixed
 * paths rather than bare names so neither the working directory nor a
 * user-modified PATH decides which binary they run.
 */
export function windowsSystemExecutable(
	name: string,
	env: Readonly<Record<string, string | undefined>> = process.env,
): string {
	return win32.join(windowsSystemRoot(env), "System32", name);
}

/**
 * Absolute path of Windows PowerShell 5.1, which ships under
 * `System32\WindowsPowerShell\v1.0\`, not directly in `System32`.
 */
export function windowsPowerShellExecutable(
	env: Readonly<Record<string, string | undefined>> = process.env,
): string {
	return win32.join(
		windowsSystemRoot(env),
		"System32",
		"WindowsPowerShell",
		"v1.0",
		"powershell.exe",
	);
}

/**
 * Merge executor-supplied environment overrides onto the inherited
 * environment the way a plain spread would, except that on Windows an
 * override replaces an inherited variable of the same name in any case.
 * Windows environment names are case-insensitive but a spread copy of
 * `process.env` is not, so `{ ...process.env, ...{ PATH } }` on a host whose
 * inherited key is `Path` would keep both — and the child would then see the
 * inherited value first, silently ignoring the override.
 */
export function mergeSpawnEnv(
	base: Readonly<Record<string, string | undefined>>,
	overrides: Readonly<Record<string, string | undefined>> | undefined,
	platform: NodeJS.Platform = process.platform,
): Record<string, string | undefined> {
	const merged: Record<string, string | undefined> = { ...base };
	if (!overrides) return merged;
	for (const [key, value] of Object.entries(overrides)) {
		if (platform === "win32") {
			const wanted = key.toLowerCase();
			for (const existing of Object.keys(merged)) {
				if (existing !== key && existing.toLowerCase() === wanted) {
					delete merged[existing];
				}
			}
		}
		merged[key] = value;
	}
	return merged;
}

/**
 * A copy of `env` without `name`. On Windows the match is case-insensitive,
 * because the OS treats differently-cased spellings as one variable and a
 * child would otherwise inherit whichever spelling survived.
 */
export function omitSpawnEnv(
	env: Readonly<Record<string, string | undefined>>,
	name: string,
	platform: NodeJS.Platform = process.platform,
): Record<string, string | undefined> {
	const wanted = name.toLowerCase();
	const result: Record<string, string | undefined> = {};
	for (const [key, value] of Object.entries(env)) {
		const matches =
			platform === "win32" ? key.toLowerCase() === wanted : key === name;
		if (!matches) result[key] = value;
	}
	return result;
}

function windowsSystemRoot(
	env: Readonly<Record<string, string | undefined>>,
): string {
	return readEnv(env, "SystemRoot") ?? readEnv(env, "windir") ?? "C:\\Windows";
}

/** Windows environment names are case-insensitive; a spread copy of process.env is not. */
function readEnv(
	env: Readonly<Record<string, string | undefined>>,
	name: string,
): string | undefined {
	const wanted = name.toLowerCase();
	for (const [key, value] of Object.entries(env)) {
		if (key.toLowerCase() === wanted) return value;
	}
	return undefined;
}
