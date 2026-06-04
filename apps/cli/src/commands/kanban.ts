import {
	type ChildProcess,
	type SpawnOptions,
	spawn,
	spawnSync,
} from "node:child_process";
import { accessSync, constants as fsConstants } from "node:fs";
import { delimiter, extname, join } from "node:path";
import { c, writeErr, writeln } from "../utils/output";

export type KanbanInstaller = "npm" | "pnpm" | "bun";

export interface KanbanInstallCommand {
	packageManager: KanbanInstaller;
	command: string;
	args: readonly string[];
	displayCommand: string;
}

export interface LaunchKanbanOptions {
	preferredInstaller?: KanbanInstaller;
}

const KANBAN_SHUTDOWN_TIMEOUT_MS = 10_000;

interface SignalableKanbanProcess {
	pid?: number;
	kill: (signal?: NodeJS.Signals | number) => boolean;
}

const KANBAN_INSTALL_COMMANDS: ReadonlyArray<
	Omit<KanbanInstallCommand, "displayCommand">
> = [
	{
		packageManager: "npm",
		command: "npm",
		args: ["install", "-g", "kanban@latest"],
	},
	{
		packageManager: "pnpm",
		command: "pnpm",
		args: ["add", "-g", "kanban@latest"],
	},
	{
		packageManager: "bun",
		command: "bun",
		args: ["add", "-g", "kanban@latest"],
	},
];

function getKanbanCommand(
	platform: NodeJS.Platform = process.platform,
): string {
	return platform === "win32" ? "kanban.cmd" : "kanban";
}

function getPackageManagerCommand(
	packageManager: KanbanInstaller,
	platform: NodeJS.Platform = process.platform,
): string {
	if (platform !== "win32") {
		return packageManager;
	}

	return packageManager === "bun" ? "bun" : `${packageManager}.cmd`;
}

function getPathEntries(env: NodeJS.ProcessEnv): string[] {
	const pathValue = env.PATH ?? env.Path ?? env.path;
	if (!pathValue) {
		return [];
	}

	return pathValue
		.split(delimiter)
		.map((entry) => entry.trim().replace(/^"(.*)"$/u, "$1"))
		.filter((entry) => entry.length > 0);
}

function pathExists(candidatePath: string, platform: NodeJS.Platform): boolean {
	try {
		if (platform === "win32") {
			accessSync(candidatePath, fsConstants.F_OK);
		} else {
			accessSync(candidatePath, fsConstants.X_OK);
		}
		return true;
	} catch {
		return false;
	}
}

export function isCommandAvailable(
	command: string,
	env: NodeJS.ProcessEnv = process.env,
	platform: NodeJS.Platform = process.platform,
): boolean {
	const commandHasExtension = extname(command).length > 0;
	const pathExtensions =
		platform === "win32"
			? (env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM")
					.split(";")
					.filter((extension) => extension.length > 0)
			: [];

	for (const pathEntry of getPathEntries(env)) {
		const commandPath = join(pathEntry, command);
		if (pathExists(commandPath, platform)) {
			return true;
		}

		if (!commandHasExtension && platform === "win32") {
			for (const extension of pathExtensions) {
				if (pathExists(`${commandPath}${extension}`, platform)) {
					return true;
				}
			}
		}
	}

	return false;
}

export function resolveKanbanInstallCommand(
	env: NodeJS.ProcessEnv = process.env,
	platform: NodeJS.Platform = process.platform,
	preferredInstaller?: KanbanInstaller,
): KanbanInstallCommand | null {
	if (preferredInstaller) {
		const preferredCommand = KANBAN_INSTALL_COMMANDS.find(
			(installCommand) => installCommand.packageManager === preferredInstaller,
		);
		if (
			preferredCommand &&
			isCommandAvailable(preferredCommand.command, env, platform)
		) {
			return {
				...preferredCommand,
				displayCommand: `${preferredCommand.command} ${preferredCommand.args.join(" ")}`,
			};
		}
	}

	for (const installCommand of KANBAN_INSTALL_COMMANDS) {
		if (isCommandAvailable(installCommand.command, env, platform)) {
			return {
				...installCommand,
				displayCommand: `${installCommand.command} ${installCommand.args.join(" ")}`,
			};
		}
	}

	return null;
}

export function shouldDetachKanbanProcess(
	platform: NodeJS.Platform = process.platform,
): boolean {
	return platform !== "win32";
}

export function buildKanbanSpawnOptions(
	options: SpawnOptions = {},
	platform: NodeJS.Platform = process.platform,
): SpawnOptions {
	return {
		stdio: "inherit",
		detached: shouldDetachKanbanProcess(platform),
		...(platform === "win32" ? { shell: true } : {}),
		...options,
	};
}

function buildKanbanInstallSpawnOptions(
	options: SpawnOptions = {},
	platform: NodeJS.Platform = process.platform,
): SpawnOptions {
	return {
		detached: false,
		stdio: "inherit",
		...(platform === "win32" ? { shell: true } : {}),
		...options,
	};
}

export function spawnKanbanProcess(options: SpawnOptions = {}): ChildProcess {
	return spawn(getKanbanCommand(), [], buildKanbanSpawnOptions(options));
}

export function spawnKanbanInstallProcess(
	installCommand: KanbanInstallCommand,
	options: SpawnOptions = {},
): ChildProcess {
	return spawn(
		getPackageManagerCommand(installCommand.packageManager),
		[...installCommand.args],
		buildKanbanInstallSpawnOptions(options),
	);
}

export function getInstalledKanbanVersion(): string | null {
	try {
		const result = spawnSync(getKanbanCommand(), ["--version"], {
			encoding: "utf8",
			shell: process.platform === "win32",
		});
		if (result.status !== 0) {
			return null;
		}

		const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
		const versionMatch = output.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/);
		return versionMatch?.[0] ?? null;
	} catch {
		return null;
	}
}

export function forwardSignalToKanbanProcess(options: {
	child: SignalableKanbanProcess;
	signal: NodeJS.Signals;
	platform?: NodeJS.Platform;
	killProcess?: (pid: number, signal: NodeJS.Signals | number) => boolean;
}): void {
	if (options.child.pid == null) {
		return;
	}

	if (shouldDetachKanbanProcess(options.platform)) {
		try {
			(options.killProcess ?? process.kill)(-options.child.pid, options.signal);
			return;
		} catch (error) {
			if (
				error &&
				typeof error === "object" &&
				"code" in error &&
				error.code === "ESRCH"
			) {
				return;
			}
		}
	}

	options.child.kill(options.signal);
}

function resolveProcessExitCode(
	code: number | null,
	signal: NodeJS.Signals | null,
): number {
	if (code !== null) {
		return code;
	}

	switch (signal) {
		case "SIGINT":
			return 130;
		case "SIGTERM":
			return 143;
		default:
			return 1;
	}
}

function waitForProcessExit(child: ChildProcess): Promise<number> {
	return new Promise<number>((resolve, reject) => {
		child.once("close", (code, signal) => {
			resolve(resolveProcessExitCode(code, signal));
		});
		child.once("error", reject);
	});
}

async function ensureKanbanInstalled(
	command: string,
	options: LaunchKanbanOptions = {},
): Promise<boolean> {
	if (isCommandAvailable(command)) {
		return true;
	}

	const installCommand = resolveKanbanInstallCommand(
		process.env,
		process.platform,
		options.preferredInstaller,
	);
	if (!installCommand) {
		writeErr('kanban is not installed. Install it with "npm i -g kanban"');
		return false;
	}

	writeln(`${c.cyan}Installing kanban@latest…${c.reset}`);
	const installProcess = spawnKanbanInstallProcess(installCommand, {
		env: process.env,
		windowsHide: true,
	});
	const installExitCode = await waitForProcessExit(installProcess).catch(
		(error: unknown) => {
			const message = error instanceof Error ? error.message : String(error);
			writeErr(`Failed to run ${installCommand.displayCommand}: ${message}`);
			return 1;
		},
	);
	if (installExitCode !== 0) {
		writeErr(
			`Failed to install kanban. Try running: ${installCommand.displayCommand}`,
		);
		return false;
	}

	if (!isCommandAvailable(command)) {
		writeErr(
			`Installed kanban, but ${command} was not found in PATH. Try opening a new terminal.`,
		);
		return false;
	}

	return true;
}

/**
 * Launch the external `kanban` app as a foreground child process.
 *
 * Returns a Promise that resolves with the exit code:
 *   kanban's exit code after the foreground process exits
 *   1 if kanban cannot be installed or spawned
 */
export async function launchKanban(
	options: LaunchKanbanOptions = {},
): Promise<number> {
	const command = getKanbanCommand();
	if (!(await ensureKanbanInstalled(command, options))) {
		return 1;
	}

	return new Promise<number>((resolve) => {
		const child = spawnKanbanProcess();
		let shutdownTimer: NodeJS.Timeout | null = null;
		let settled = false;

		const clearShutdownTimer = () => {
			if (!shutdownTimer) {
				return;
			}
			clearTimeout(shutdownTimer);
			shutdownTimer = null;
		};

		const cleanup = () => {
			clearShutdownTimer();
			process.off("SIGINT", handleSigint);
			process.off("SIGTERM", handleSigterm);
		};

		const settle = (code: number) => {
			if (settled) {
				return;
			}
			settled = true;
			cleanup();
			resolve(code);
		};

		const requestShutdown = (signal: NodeJS.Signals) => {
			forwardSignalToKanbanProcess({ child, signal });

			clearShutdownTimer();
			if (signal === "SIGKILL") {
				return;
			}

			shutdownTimer = setTimeout(() => {
				forwardSignalToKanbanProcess({ child, signal: "SIGKILL" });
			}, KANBAN_SHUTDOWN_TIMEOUT_MS);
			shutdownTimer.unref?.();
		};

		function handleSigint() {
			requestShutdown("SIGINT");
		}

		function handleSigterm() {
			requestShutdown("SIGTERM");
		}

		process.on("SIGINT", handleSigint);
		process.on("SIGTERM", handleSigterm);

		child.once("error", (error) => {
			const message = error instanceof Error ? error.message : String(error);
			writeErr(`Failed to run kanban: ${message}`);
			settle(1);
		});
		child.once("close", (code, signal) => {
			settle(resolveProcessExitCode(code, signal));
		});
	});
}
