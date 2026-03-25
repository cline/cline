import { type ChildProcess, type SpawnOptions, spawn } from "node:child_process"
import { StateManager } from "@/core/storage/StateManager"
import { checkAnyProviderConfigured } from "./auth"

export const KANBAN_LAUNCH_ARGS = ["-y", "kanban@latest"] as const
export const KANBAN_LAUNCH_COMMAND = `npx ${KANBAN_LAUNCH_ARGS.join(" ")}`
export const KANBAN_SHUTDOWN_TIMEOUT_MS = 10_000
export const LEGACY_TUI_FLAG = "--tui"
export type KanbanMigrationAction = "kanban" | "exit"

interface SignalableKanbanProcess {
	pid?: number
	kill: (signal?: NodeJS.Signals | number) => boolean
}

function getNpxCommand(): string {
	return process.platform === "win32" ? "npx.cmd" : "npx"
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

export function spawnKanbanProcess(options: SpawnOptions = {}): ChildProcess {
	return spawn(getNpxCommand(), [...KANBAN_LAUNCH_ARGS], buildKanbanSpawnOptions(options))
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
