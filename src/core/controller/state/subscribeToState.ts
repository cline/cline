import { EmptyRequest } from "@shared/proto/cline/common"
import { State } from "@shared/proto/cline/state"
import { ExtensionState } from "@/shared/ExtensionMessage"
import { Logger } from "@/shared/services/Logger"
import { getRequestRegistry, StreamingResponseHandler } from "../grpc-handler"
import { Controller } from "../index"
import { recordStateSnapshotTelemetry, serializeStateSnapshot } from "./stateSnapshot"

// Keep track of active state subscriptions
const activeStateSubscriptions = new Map<StreamingResponseHandler<State>, string>()

export function hasActiveStateSubscribers(): boolean {
	return activeStateSubscriptions.size > 0
}

export function resetStateSubscriptionsForTest(): void {
	activeStateSubscriptions.clear()
}

/**
 * Subscribe to state updates
 * @param controller The controller instance
 * @param request The empty request
 * @param responseStream The streaming response handler
 * @param requestId The ID of the request (passed by the gRPC handler)
 */
export async function subscribeToState(
	controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<State>,
	requestId?: string,
): Promise<void> {
	// Add this subscription to the active subscriptions
	activeStateSubscriptions.set(responseStream, "")

	// Register cleanup when the connection is closed
	const cleanup = () => {
		activeStateSubscriptions.delete(responseStream)
	}

	// Register the cleanup function with the request registry if we have a requestId
	if (requestId) {
		getRequestRegistry().registerRequest(requestId, cleanup, { type: "state_subscription" }, responseStream)
	}

	// Send the initial state
	const initialState = await controller.getStateToPostToWebview()
	const { stateJson: initialStateJson, sizeBytes } = serializeStateSnapshot(initialState)

	recordStateSizeTelemetry(sizeBytes)

	try {
		await responseStream(
			{
				stateJson: initialStateJson,
			},
			false, // Not the last message
		)
		activeStateSubscriptions.set(responseStream, initialStateJson)
	} catch (error) {
		Logger.error("Error sending initial state:", error)
		activeStateSubscriptions.delete(responseStream)
	}
}

/**
 * Send a state update to all active subscribers
 * @param state The state to send
 */
export async function sendStateUpdate(state: ExtensionState): Promise<void> {
	if (!hasActiveStateSubscribers()) {
		return
	}

	let stateJson: string
	let sizeBytes: number
	try {
		const serialized = serializeStateSnapshot(state)
		stateJson = serialized.stateJson
		sizeBytes = serialized.sizeBytes
	} catch (error) {
		Logger.error("Error serializing state update:", error)
		return
	}

	const subscribersNeedingUpdate = Array.from(activeStateSubscriptions.entries()).filter(
		([_responseStream, lastStateJson]) => lastStateJson !== stateJson,
	)
	if (subscribersNeedingUpdate.length === 0) {
		return
	}

	recordStateSizeTelemetry(sizeBytes)

	const promises = subscribersNeedingUpdate.map(async ([responseStream]) => {
		try {
			await responseStream(
				{
					stateJson,
				},
				false, // Not the last message
			)
			activeStateSubscriptions.set(responseStream, stateJson)
		} catch (error) {
			Logger.error("Error sending state update:", error)
			activeStateSubscriptions.delete(responseStream)
		}
	})

	await Promise.all(promises)
}

function recordStateSizeTelemetry(sizeBytes: number): void {
	recordStateSnapshotTelemetry(sizeBytes, "subscribeToState")
}
