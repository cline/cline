import { type ChildProcess, type SpawnOptions, spawn } from "node:child_process"

export const KANBAN_LAUNCH_ARGS = ["-y", "kanban@latest"] as const
export const KANBAN_LAUNCH_COMMAND = `npx ${KANBAN_LAUNCH_ARGS.join(" ")}`

function getNpxCommand(): string {
	return process.platform === "win32" ? "npx.cmd" : "npx"
}

export function spawnKanbanProcess(options: SpawnOptions = {}): ChildProcess {
	return spawn(getNpxCommand(), [...KANBAN_LAUNCH_ARGS], {
		stdio: "inherit",
		...options,
	})
}
