import type { PresentationPriority } from "./TaskPresentationScheduler"

export type TaskLatencyTrigger = "text" | "reasoning" | "tool" | "finalization" | "other"

export function isRemoteWorkspaceEnvironment(host: { platform?: string; version?: string; remoteName?: string | null }): boolean {
	if (host.remoteName) {
		return true
	}

	const platform = host.platform?.toLowerCase() ?? ""
	const version = host.version?.toLowerCase() ?? ""
	return platform.includes("remote") || version.includes("remote")
}

export function getPresentationCadenceMs(isRemoteWorkspace: boolean, priority: PresentationPriority): number {
	if (priority === "immediate") {
		return 0
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

	if (priority === "low") {
		return isRemoteWorkspace ? 150 : 40
	}

	return isRemoteWorkspace ? 110 : 16
}

export function getUsageUpdateCadenceMs(isRemoteWorkspace: boolean): number {
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
