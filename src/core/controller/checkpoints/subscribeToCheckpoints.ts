import { CheckpointEvent, CheckpointEvent_OperationType, CheckpointSubscriptionRequest } from "@shared/proto/cline/checkpoints"
import { Timestamp } from "@shared/proto/google/protobuf/timestamp"
import { getRequestRegistry, StreamingResponseHandler } from "../grpc-handler"
import { Controller } from "../index"

/**
 * Parameters for creating a checkpoint event
 */
export interface CheckpointEventData {
	operation: keyof typeof CheckpointEvent_OperationType
	cwdHash: string
	isActive: boolean
	taskId?: string
	commitHash?: string
}

/**
 * Track active checkpoint subscriptions per workspace.
 * Map structure: cwdHash -> Set of response streams
 */
const activeCheckpointSubscriptions = new Map<string, Set<StreamingResponseHandler<CheckpointEvent>>>()

/**
 * Subscribe to checkpoint events for a specific workspace.
 *
 * Clients receive real-time notifications about checkpoint operations:
 * - Shadow git initialization
 * - Commit creation
 * - Checkpoint restoration
 *
 * Each operation generates two events (start and completion).
 *
 * @param controller The controller instance
 * @param request The subscription request containing cwdHash
 * @param responseStream The streaming response handler
 * @param requestId The ID of the request
 */
export async function subscribeToCheckpoints(
	_controller: Controller,
	request: CheckpointSubscriptionRequest,
	responseStream: StreamingResponseHandler<CheckpointEvent>,
	requestId?: string,
): Promise<void> {
	const { cwdHash } = request

	if (!activeCheckpointSubscriptions.has(cwdHash)) {
		activeCheckpointSubscriptions.set(cwdHash, new Set())
	}

	const subscriptions = activeCheckpointSubscriptions.get(cwdHash)
	if (!subscriptions) {
		throw new Error(`Failed to retrieve subscriptions for cwdHash: ${cwdHash}`)
	}

	subscriptions.add(responseStream)

	// Register cleanup when the connection is closed
	const cleanup = () => {
		subscriptions.delete(responseStream)
		if (subscriptions.size === 0) {
			activeCheckpointSubscriptions.delete(cwdHash)
		}
	}

	if (requestId) {
		getRequestRegistry().registerRequest(
			requestId,
			cleanup,
			{ type: "checkpoint_subscription" as const, cwdHash },
			responseStream,
		)
	}
}

/**
 * Send a checkpoint event to all subscribers of the specified workspace.
 *
 * @param eventData The checkpoint event to send
 */
export async function sendCheckpointEvent(eventData: CheckpointEventData): Promise<void> {
	const { cwdHash } = eventData

	const subscriptions = activeCheckpointSubscriptions.get(cwdHash)
	if (!subscriptions || subscriptions.size === 0) {
		return
	}

	const now = new Date()
	const timestamp: Timestamp = {
		seconds: Math.trunc(now.getTime() / 1_000),
		nanos: (now.getTime() % 1_000) * 1_000_000,
	}

	const event: CheckpointEvent = {
		operation: CheckpointEvent_OperationType[eventData.operation],
		cwdHash: eventData.cwdHash,
		isActive: eventData.isActive,
		timestamp,
		taskId: eventData.taskId,
		commitHash: eventData.commitHash,
	}

	// Send the event to all active subscribers for this workspace
	const promises = Array.from(subscriptions).map(async (responseStream) => {
		try {
			await responseStream(event, false) // Not the last message
		} catch (error) {
			console.error("Error sending checkpoint event:", error)
			subscriptions.delete(responseStream)
			if (subscriptions.size === 0) {
				activeCheckpointSubscriptions.delete(cwdHash)
			}
		}
	})

	await Promise.all(promises)
}
