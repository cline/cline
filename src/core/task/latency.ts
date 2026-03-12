import type { PresentationPriority } from "./TaskPresentationScheduler"

export type TaskLatencyTrigger = "text" | "reasoning" | "tool" | "finalization" | "other"

function readBooleanEnv(envVarName: string): boolean {
	const rawValue = process.env[envVarName]?.toLowerCase()
	return rawValue === "1" || rawValue === "true" || rawValue === "yes"
}

function readCadenceOverride(envVarName: string): number | undefined {
	const rawValue = process.env[envVarName]
	if (!rawValue) {
		return undefined
	}

	const parsed = Number.parseInt(rawValue, 10)
	if (!Number.isFinite(parsed) || parsed < 0) {
		return undefined
	}

	return parsed
}

function getCadenceOverride(args: { isRemoteWorkspace: boolean; localEnvVar: string; remoteEnvVar: string }): number | undefined {
	return args.isRemoteWorkspace ? readCadenceOverride(args.remoteEnvVar) : readCadenceOverride(args.localEnvVar)
}

export function isRemoteWorkspaceEnvironment(host: { platform?: string; version?: string; remoteName?: string | null }): boolean {
	if (host.remoteName) {
		return true
	}

	const platform = host.platform?.toLowerCase() ?? ""
	const version = host.version?.toLowerCase() ?? ""
	return platform.includes("remote") || version.includes("remote")
}

export function isPresentationSchedulingDisabled(): boolean {
	return readBooleanEnv("CLINE_DISABLE_PRESENTATION_SCHEDULER")
}

export function isEphemeralMessagePersistenceDisabled(): boolean {
	return readBooleanEnv("CLINE_DISABLE_EPHEMERAL_MESSAGE_PERSISTENCE")
}

export function isTaskUiDeltaSyncDisabled(): boolean {
	return readBooleanEnv("CLINE_DISABLE_TASK_UI_DELTA_SYNC")
}

export function getPresentationCadenceMs(isRemoteWorkspace: boolean, priority: PresentationPriority): number {
	if (priority === "immediate") {
		return 0
	}

	const override = getCadenceOverride({
		isRemoteWorkspace,
		localEnvVar: priority === "low" ? "CLINE_PRESENTATION_LOW_CADENCE_MS" : "CLINE_PRESENTATION_CADENCE_MS",
		remoteEnvVar: priority === "low" ? "CLINE_REMOTE_PRESENTATION_LOW_CADENCE_MS" : "CLINE_REMOTE_PRESENTATION_CADENCE_MS",
	})
	if (override !== undefined) {
		return override
	}

	if (priority === "low") {
		return isRemoteWorkspace ? 125 : 50
	}

	return isRemoteWorkspace ? 90 : 40
}

export function getStateUpdateCadenceMs(isRemoteWorkspace: boolean, priority: PresentationPriority): number {
	if (priority === "immediate") {
		return 0
	}

	const override = getCadenceOverride({
		isRemoteWorkspace,
		localEnvVar: priority === "low" ? "CLINE_STATE_UPDATE_LOW_CADENCE_MS" : "CLINE_STATE_UPDATE_CADENCE_MS",
		remoteEnvVar: priority === "low" ? "CLINE_REMOTE_STATE_UPDATE_LOW_CADENCE_MS" : "CLINE_REMOTE_STATE_UPDATE_CADENCE_MS",
	})
	if (override !== undefined) {
		return override
	}

	if (priority === "low") {
		return isRemoteWorkspace ? 150 : 40
	}

	return isRemoteWorkspace ? 110 : 16
}

export function getUsageUpdateCadenceMs(isRemoteWorkspace: boolean): number {
	const override = getCadenceOverride({
		isRemoteWorkspace,
		localEnvVar: "CLINE_USAGE_UPDATE_CADENCE_MS",
		remoteEnvVar: "CLINE_REMOTE_USAGE_UPDATE_CADENCE_MS",
	})
	if (override !== undefined) {
		return override
	}

	return isRemoteWorkspace ? 400 : 250
}

export function summarizeChunkToWebviewDelays(delaysMs: number[]): { medianMs: number; p95Ms: number } {
	if (delaysMs.length === 0) {
		return { medianMs: 0, p95Ms: 0 }
	}

	const sorted = [...delaysMs].sort((a, b) => a - b)
	const percentile = (ratio: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))]
	return {
		medianMs: percentile(0.5),
		p95Ms: percentile(0.95),
	}
}
