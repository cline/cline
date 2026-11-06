import { EmptyRequest } from "@shared/proto/cline/common"
import { State } from "@shared/proto/cline/state"
import { telemetryService } from "@/services/telemetry"
import { ExtensionState } from "@/shared/ExtensionMessage"
import { Logger } from "@/shared/services/Logger"
import { getRequestRegistry, StreamingResponseHandler } from "../grpc-handler"
import { Controller } from "../index"
import { DeltaEncoder } from "@shared/delta-state-update"

// Keep track of active state subscriptions
const activeStateSubscriptions = new Set<StreamingResponseHandler<State>>()

// TODO: This is a hack to shim in the state delta encoder to the existing updater
let stateGetter: () => any = () => {
	throw new Error("stateGetter not initialized")
}
let deltaEncoder: DeltaEncoder<object> | undefined

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
	activeStateSubscriptions.add(responseStream)

	// Register cleanup when the connection is closed
	const cleanup = () => {
		activeStateSubscriptions.delete(responseStream)
	}

	// Register the cleanup function with the request registry if we have a requestId
	if (requestId) {
		getRequestRegistry().registerRequest(requestId, cleanup, { type: "state_subscription" }, responseStream)
	}

	// Send the initial state
	if (!deltaEncoder) {
		stateGetter = () => controller.getStateToPostToWebview()
		deltaEncoder = new DeltaEncoder<object>(() => stateGetter())
	}
	const initialState = await deltaEncoder.initialUpdate()
	const initialStateJson = JSON.stringify(initialState)

	recordStateSizeTelemetry(Buffer.byteLength(initialStateJson, "utf8"))

	try {
		await responseStream(
			{
				stateJson: initialStateJson,
			},
			false, // Not the last message
		)
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
	if (!deltaEncoder) {
		// There must be no subscriptions!
		console.assert(
			activeStateSubscriptions.size === 0,
			"if active state subscriptions, deltaEncoder must have been initialized",
		)
		return
	}

	// TODO: this is the write side of the hack which adapts state pushing to state pulling by the encoder
	stateGetter = () => state
	let stateJson: string
	try {
		const delta = await deltaEncoder.getUpdate()
		stateJson = JSON.stringify(delta)
	} catch (error) {
		Logger.error("Error serializing state update:", error)
		return
	}

	recordStateSizeTelemetry(Buffer.byteLength(stateJson, "utf8"))

	// FIRE-AND-FORGET: do not await delivery to the webview (it may be hidden/reloaded/closed
	// and postMessage can hang or resolve false). The webview reconciles convergently from
	// whatever state snapshots it receives, gated by stateVersion/epoch.
	for (const responseStream of activeStateSubscriptions) {
		responseStream(
			{
				stateJson,
			},
			false, // Not the last message
		).catch((error) => {
			Logger.error("Error sending state update:", error)
			activeStateSubscriptions.delete(responseStream)
		})
	}
}

function recordStateSizeTelemetry(sizeBytes: number): void {
	telemetryService.captureGrpcResponseSize(sizeBytes, "cline.StateService", "subscribeToState")
}
