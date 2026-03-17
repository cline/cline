import { Logger } from "@/shared/services/Logger"
import type { PresentationPriority } from "./TaskPresentationScheduler"

export type TaskLatencyTrigger = "text" | "reasoning" | "tool"

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
		Logger.warn(`[latency] Ignoring invalid cadence override ${envVarName}="${rawValue}" (must be a non-negative integer)`)
		return undefined
	}

	return parsed
}

function getCadenceOverride(args: { isRemoteWorkspace: boolean; localEnvVar: string; remoteEnvVar: string }): number | undefined {
	return args.isRemoteWorkspace ? readCadenceOverride(args.remoteEnvVar) : readCadenceOverride(args.localEnvVar)
}

/**
 * Determines whether the host is connected to a remote workspace.
 *
 * The primary signal is `remoteName` which is populated from `vscode.env.remoteName`
 * (e.g. `"ssh-remote"`, `"dev-container"`, `"codespaces"`). When this field is present
 * the host is definitively remote.
 *
 * The `platform`/`version` heuristic is a best-effort fallback for non-VSCode hosts
 * (e.g. JetBrains) that may not populate `remoteName` but include "remote" in their
 * platform or version strings. This can produce false positives for strings like
 * "1.0.0-remote-fix" — prefer populating `remoteName` in host bridges when possible.
 */
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

export function getPresentationCadenceMs(isRemoteWorkspace: boolean, priority: PresentationPriority): number {
	if (priority === "immediate") {
		return 0
	}

	const override = getCadenceOverride({
		isRemoteWorkspace,
		localEnvVar: "CLINE_PRESENTATION_CADENCE_MS",
		remoteEnvVar: "CLINE_REMOTE_PRESENTATION_CADENCE_MS",
	})
	if (override !== undefined) {
		return override
	}

	// Default cadences: remote workspaces use a higher interval to reduce
	// message-passing overhead over the network.
	return isRemoteWorkspace ? 90 : 40
}
