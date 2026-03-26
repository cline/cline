import { type ChildProcess, type SpawnOptions, spawn } from "node:child_process"
import { accessSync, constants as fsConstants } from "node:fs"
import { delimiter, extname, join } from "node:path"
import { StateManager } from "@/core/storage/StateManager"
import { checkAnyProviderConfigured } from "./auth"

export const KANBAN_LAUNCH_COMMAND = "kanban"
export const KANBAN_SHUTDOWN_TIMEOUT_MS = 10_000
export const LEGACY_TUI_FLAG = "--tui"
export type KanbanMigrationAction = "kanban" | "exit"
type KanbanInstaller = "npm" | "pnpm" | "bun"

interface KanbanInstallCommand {
	packageManager: KanbanInstaller
	command: string
	args: readonly string[]
	displayCommand: string
}

interface SignalableKanbanProcess {
	pid?: number
	kill: (signal?: NodeJS.Signals | number) => boolean
}

function getKanbanCommand(platform: NodeJS.Platform = process.platform): string {
	return platform === "win32" ? "kanban.cmd" : "kanban"
}

function getPackageManagerCommand(packageManager: KanbanInstaller, platform: NodeJS.Platform = process.platform): string {
	if (platform !== "win32") {
		return packageManager
	}

	return packageManager === "bun" ? "bun" : `${packageManager}.cmd`
}

const KANBAN_INSTALL_COMMANDS: ReadonlyArray<Omit<KanbanInstallCommand, "displayCommand">> = [
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
]

function toDisplayCommand(command: string, args: readonly string[]): string {
	return `${command} ${args.join(" ")}`
}

export function shouldDetachKanbanProcess(platform: NodeJS.Platform = process.platform): boolean {
	return platform !== "win32"
}

export function buildKanbanSpawnOptions(options: SpawnOptions = {}, platform: NodeJS.Platform = process.platform): SpawnOptions {
	return {
		stdio: "inherit",
		detached: shouldDetachKanbanProcess(platform),
		...(platform === "win32" ? { shell: true } : {}),
		...options,
	}
}

export function buildKanbanInstallSpawnOptions(
	options: SpawnOptions = {},
	platform: NodeJS.Platform = process.platform,
): SpawnOptions {
	return {
		stdio: "inherit",
		detached: false,
		...(platform === "win32" ? { shell: true } : {}),
		...options,
	}
}

export function spawnKanbanProcess(options: SpawnOptions = {}): ChildProcess {
	return spawn(getKanbanCommand(), [], buildKanbanSpawnOptions(options))
}

export function spawnKanbanInstallProcess(installCommand: KanbanInstallCommand, options: SpawnOptions = {}): ChildProcess {
	return spawn(
		getPackageManagerCommand(installCommand.packageManager),
		[...installCommand.args],
		buildKanbanInstallSpawnOptions(options),
	)
}

function getPathEntries(env: NodeJS.ProcessEnv): string[] {
	const pathValue = env.PATH ?? env.Path ?? env.path
	if (!pathValue) {
		return []
	}

	return pathValue
		.split(delimiter)
		.map((entry) => entry.trim().replace(/^"(.*)"$/u, "$1"))
		.filter((entry) => entry.length > 0)
}

function pathExists(candidatePath: string, platform: NodeJS.Platform): boolean {
	try {
		if (platform === "win32") {
			accessSync(candidatePath, fsConstants.F_OK)
		} else {
			accessSync(candidatePath, fsConstants.X_OK)
		}
		return true
	} catch {
		return false
	}
}

export function isCommandAvailable(
	command: string,
	env: NodeJS.ProcessEnv = process.env,
	platform: NodeJS.Platform = process.platform,
): boolean {
	const commandHasExtension = extname(command).length > 0
	const pathExtensions =
		platform === "win32" ? (env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";").filter((ext) => ext.length > 0) : []

	for (const pathEntry of getPathEntries(env)) {
		const commandPath = join(pathEntry, command)
		if (pathExists(commandPath, platform)) {
			return true
		}

		if (!commandHasExtension && platform === "win32") {
			for (const extension of pathExtensions) {
				if (pathExists(`${commandPath}${extension}`, platform)) {
					return true
				}
			}
		}
	}

	return false
}

export function isKanbanCommandAvailable(
	env: NodeJS.ProcessEnv = process.env,
	platform: NodeJS.Platform = process.platform,
): boolean {
	return isCommandAvailable(getKanbanCommand(platform), env, platform)
}

export function resolveKanbanInstallCommand(
	env: NodeJS.ProcessEnv = process.env,
	platform: NodeJS.Platform = process.platform,
): KanbanInstallCommand | null {
	for (const installCommand of KANBAN_INSTALL_COMMANDS) {
		if (isCommandAvailable(installCommand.command, env, platform)) {
			return {
				...installCommand,
				displayCommand: toDisplayCommand(installCommand.command, installCommand.args),
			}
		}
	}

	return null
}

export function forwardSignalToKanbanProcess(options: {
	child: SignalableKanbanProcess
	signal: NodeJS.Signals
	platform?: NodeJS.Platform
	killProcess?: (pid: number, signal: NodeJS.Signals | number) => boolean
}): void {
	if (options.child.pid == null) {
		return
	}

	if (shouldDetachKanbanProcess(options.platform)) {
		try {
			;(options.killProcess ?? process.kill)(-options.child.pid, options.signal)
			return
		} catch (error) {
			if (error && typeof error === "object" && "code" in error && error.code === "ESRCH") {
				return
			}
		}
	}

	options.child.kill(options.signal)
}

export function shouldLaunchKanbanByDefault(options: {
	prompt?: string
	stdinWasPiped: boolean
	taskId?: string
	continue?: boolean
	tui?: boolean
}): boolean {
	return !options.prompt && !options.stdinWasPiped && !options.taskId && !options.continue && !options.tui
}

export function hasUsedLegacyCli(options: {
	taskHistoryCount: number
	isNewUser: boolean
	welcomeViewCompleted: boolean | undefined
	hasConfiguredAuth: boolean
}): boolean {
	return (
		options.taskHistoryCount > 0 ||
		options.isNewUser === false ||
		options.welcomeViewCompleted !== undefined ||
		options.hasConfiguredAuth
	)
}

export function shouldShowKanbanMigrationAnnouncement(options: {
	announcementShown: boolean
	hasUsedLegacyCli: boolean
}): boolean {
	return !options.announcementShown && options.hasUsedLegacyCli
}

export async function shouldShowKanbanMigrationAnnouncementForCurrentUser(): Promise<boolean> {
	const stateManager = StateManager.get()
	const hasConfiguredAuth = await checkAnyProviderConfigured()
	const hasUsedLegacy = hasUsedLegacyCli({
		taskHistoryCount: stateManager.getGlobalStateKey("taskHistory")?.length ?? 0,
		isNewUser: stateManager.getGlobalStateKey("isNewUser"),
		welcomeViewCompleted: stateManager.getGlobalStateKey("welcomeViewCompleted"),
		hasConfiguredAuth,
	})

	return shouldShowKanbanMigrationAnnouncement({
		announcementShown: stateManager.getGlobalStateKey("cliKanbanMigrationAnnouncementShown"),
		hasUsedLegacyCli: hasUsedLegacy,
	})
}

export async function markKanbanMigrationAnnouncementShown(): Promise<void> {
	const stateManager = StateManager.get()
	stateManager.setGlobalState("cliKanbanMigrationAnnouncementShown", true)
	await stateManager.flushPendingState()
}
