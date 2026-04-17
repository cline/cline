import { telemetryService } from "@/services/telemetry"
import type { ExtensionState } from "@/shared/ExtensionMessage"
import { Logger } from "@/shared/services/Logger"

export const LARGE_STATE_SNAPSHOT_WARNING_BYTES = 4 * 1024 * 1024
const STATE_SERVICE_NAME = "cline.StateService"

export function serializeStateSnapshot(state: ExtensionState): { stateJson: string; sizeBytes: number } {
	const stateJson = JSON.stringify(state)
	return {
		stateJson,
		sizeBytes: Buffer.byteLength(stateJson, "utf8"),
	}
}

export function warnOnLargeStateSnapshot(sizeBytes: number, method: string): boolean {
	if (sizeBytes <= LARGE_STATE_SNAPSHOT_WARNING_BYTES) {
		return false
	}

	Logger.warn(
		`[StateService] Large state snapshot for ${method}: ` +
			`size=${(sizeBytes / (1024 * 1024)).toFixed(1)}MB (threshold=${(LARGE_STATE_SNAPSHOT_WARNING_BYTES / (1024 * 1024)).toFixed(1)}MB)`,
	)
	return true
}

export function recordStateSnapshotTelemetry(sizeBytes: number, method: string): void {
	telemetryService.captureGrpcResponseSize(sizeBytes, STATE_SERVICE_NAME, method)
	warnOnLargeStateSnapshot(sizeBytes, method)
}
