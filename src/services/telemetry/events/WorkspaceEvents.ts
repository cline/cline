import type { TelemetryProperties } from "../providers/ITelemetryProvider"
import type { TelemetryService } from "../TelemetryService"
import { EventHandlerBase } from "./EventHandlerBase"

/**
 * Property types for workspace telemetry events
 */

export interface WorkspaceInitializedProperties extends TelemetryProperties {
	root_count: number
	vcs_types: string[]
	is_multi_root: boolean
	has_git: boolean
	has_mercurial: boolean
	init_duration_ms?: number
	feature_flag_enabled?: boolean
}

export interface WorkspaceInitErrorProperties extends TelemetryProperties {
	error_type: string
	error_message: string
	fallback_to_single_root: boolean
	workspace_count: number
}

export interface MultiRootCheckpointProperties extends TelemetryProperties {
	ulid: string
	action: "initialized" | "committed" | "restored"
	root_count: number
	success_count: number
	failure_count: number
	success_rate: number
	duration_ms?: number
}

/**
 * Event handler for workspace-related telemetry events
 */
export class WorkspaceEvents extends EventHandlerBase {
	static override readonly prefix = "workspace"

	/**
	 * Records when workspace is initialized
	 * @param service The telemetry service instance
	 * @param rootCount Number of workspace roots
	 * @param vcsTypes Array of VCS types detected
	 * @param initDurationMs Time taken to initialize in milliseconds
	 * @param featureFlagEnabled Whether multi-root feature flag is enabled
	 */
	static captureWorkspaceInitialized(
		service: TelemetryService,
		rootCount: number,
		vcsTypes: string[],
		initDurationMs?: number,
		featureFlagEnabled?: boolean,
	): void {
		const properties: WorkspaceInitializedProperties = {
			root_count: rootCount,
			vcs_types: vcsTypes,
			is_multi_root: rootCount > 1,
			has_git: vcsTypes.includes("Git"),
			has_mercurial: vcsTypes.includes("Mercurial"),
			init_duration_ms: initDurationMs,
			feature_flag_enabled: featureFlagEnabled,
		}
		WorkspaceEvents.capture(service, "workspace.initialized", properties)
	}

	/**
	 * Records workspace initialization errors
	 * @param service The telemetry service instance
	 * @param error The error that occurred
	 * @param fallbackMode Whether system fell back to single-root mode
	 * @param workspaceCount Number of workspace folders detected
	 */
	static captureWorkspaceInitError(
		service: TelemetryService,
		error: Error,
		fallbackMode: boolean,
		workspaceCount?: number,
	): void {
		const properties: WorkspaceInitErrorProperties = {
			error_type: error.constructor.name,
			error_message: error.message.substring(0, 500), // Truncate long error messages
			fallback_to_single_root: fallbackMode,
			workspace_count: workspaceCount ?? 0,
		}
		WorkspaceEvents.capture(service, "workspace.init_error", properties)
	}

	/**
	 * Records multi-root checkpoint operations
	 * @param service The telemetry service instance
	 * @param ulid Task identifier
	 * @param action Type of checkpoint action
	 * @param rootCount Number of roots being checkpointed
	 * @param successCount Number of successful checkpoints
	 * @param failureCount Number of failed checkpoints
	 * @param durationMs Total operation duration in milliseconds
	 */
	static captureMultiRootCheckpoint(
		service: TelemetryService,
		ulid: string,
		action: "initialized" | "committed" | "restored",
		rootCount: number,
		successCount: number,
		failureCount: number,
		durationMs?: number,
	): void {
		const properties: MultiRootCheckpointProperties = {
			ulid,
			action,
			root_count: rootCount,
			success_count: successCount,
			failure_count: failureCount,
			success_rate: rootCount > 0 ? successCount / rootCount : 0,
			duration_ms: durationMs,
		}
		WorkspaceEvents.capture(service, "workspace.multi_root_checkpoint", properties)
	}
}
