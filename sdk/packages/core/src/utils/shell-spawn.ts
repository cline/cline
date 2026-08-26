import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";

export type { ChildProcess, SpawnOptions };

export interface PlatformSpawnOptions extends SpawnOptions {
	cwd?: string;
}

function quoteSegmentForCmd(value: string): string {
	return /\s/.test(value) ? `"${value}"` : value;
}

/**
 * Spawn a host command with Windows batch-launcher handling.
 *
 * On win32, common package managers (npm) and some tools resolve to .cmd
 * batch launchers that cannot be spawned directly without a shell (the
 * failure surfaces as `spawn EFTYPE`). This helper routes win32 spawns
 * through cmd.exe and quotes only segments containing whitespace (e.g.
 * `--prefix C:\Users\John Doe\repo`); plain tokens such as "install" are
 * left untouched so argument shapes stay identical across platforms.
 *
 * Non-Windows platforms behave exactly like a direct `spawn` call.
 */
export function spawnPlatformCommand(
	command: string,
	args: string[],
	options: PlatformSpawnOptions = {},
): ChildProcess {
	const useShell = process.platform === "win32";
	return spawn(
		useShell ? quoteSegmentForCmd(command) : command,
		useShell ? args.map(quoteSegmentForCmd) : args,
		{
			...options,
			// Prevent console-window flashes for background tool processes.
			windowsHide: true,
			shell: useShell,
		},
	);
}
