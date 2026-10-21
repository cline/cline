import { CheckpointExistsForMessageResponse } from "@shared/proto/cline/checkpoints"

/**
 * Whether Reset Code can restore the workspace from a user message. When it
 * cannot, `errorMessage` is a user-facing explanation to show as-is, or
 * undefined when the cause is unknown.
 */
export type WorkspaceCheckpointAvailability = { exists: true } | { exists: false; errorMessage: string | undefined }

export function toCheckpointExistsForMessageResponse(
	availability: WorkspaceCheckpointAvailability,
): CheckpointExistsForMessageResponse {
	return CheckpointExistsForMessageResponse.create(
		availability.exists ? { exists: true } : { exists: false, errorMessage: availability.errorMessage ?? "" },
	)
}

export function fromCheckpointExistsForMessageResponse(
	response: CheckpointExistsForMessageResponse,
): WorkspaceCheckpointAvailability {
	return response.exists ? { exists: true } : { exists: false, errorMessage: response.errorMessage || undefined }
}
