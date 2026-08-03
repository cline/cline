import { EmptyRequest, StringRequest } from "@shared/proto/cline/common"
import { State } from "@shared/proto/cline/state"
import { telemetryService } from "@/services/telemetry"
import { ExtensionState } from "@/shared/ExtensionMessage"
import { Logger } from "@/shared/services/Logger"
import { getRequestRegistry, StreamingResponseHandler } from "../grpc-handler"
import { Controller } from "../index"

// Keep track of active state subscriptions
const activeStateSubscriptions = new Set<StreamingResponseHandler<State>>()

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
	const initialState = await controller.getStateToPostToWebview()
	const initialStateJson = JSON.stringify(initialState)

	recordStateSizeTelemetry(Buffer.byteLength(initialStateJson, "utf8"))

	try {
		await responseStream(
			{
				stateJson: initialStateJson,
				// Out-of-band version lets the webview gate BEFORE JSON.parse.
				stateVersion: initialState.stateVersion,
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
	let stateJson: string
	try {
		stateJson = JSON.stringify(state)
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
				// Out-of-band version lets the webview gate BEFORE JSON.parse.
				stateVersion: state.stateVersion,
			},
			false, // Not the last message
		).catch((error) => {
			Logger.error("Error sending state update:", error)
			activeStateSubscriptions.delete(responseStream)
		})
	}
}

/**
 * State delta types for incremental state updates.
 */
export interface StateDeltaMessage {
	type: "append_message" | "update_message" | "replace_all"
	payload: unknown
	version: number
}

/**
 * Send a state delta to all active subscribers (incremental update).
 * This is lighter-weight than sendStateUpdate() because it ships only
 * the changed fields instead of the full ExtensionState.
 *
 * The delta is sent in the `deltaJson` field of the State proto message,
 * NOT `stateJson`. The webview's ExtensionStateContext checks `deltaJson`
 * first:
 * - If present, it applies the delta through the convergent-replica reducer
 *   (messageReducer.ts) and updates only the changed parts of its state.
 * - If `stateJson` is also present in the same message, it is treated as
 *   the ground-truth full snapshot and the delta is ignored.
 * - If neither is present, the message is a heartbeat and skipped.
 *
 * Fire-and-forget: errors are logged but not propagated. The next full
 * snapshot always carries ground truth.
 */
export async function sendStateDelta(delta: StateDeltaMessage): Promise<void> {
	let deltaJson: string
	try {
		deltaJson = JSON.stringify(delta)
	} catch (error) {
		Logger.error("Error serializing state delta:", error)
		return
	}

	for (const responseStream of activeStateSubscriptions) {
		responseStream(
			{
				stateJson: "", // sentinel: webview checks deltaJson first when present
				deltaJson,
			},
			false,
		).catch((error) => {
			Logger.error("Error sending state delta:", error)
			activeStateSubscriptions.delete(responseStream)
		})
	}
}

/**
 * Handle a full-sync request from the webview.
 *
 * The webview calls this when it detects a version-hash mismatch or a
 * gap in delta messages (self-healing protocol). The backend responds by
 * sending the full current state snapshot through the subscription stream.
 */
export async function requestFullSync(controller: Controller, _request: StringRequest): Promise<void> {
	const state = await controller.getStateToPostToWebview()
	const stateJson = JSON.stringify(state)

	for (const responseStream of activeStateSubscriptions) {
		responseStream(
			{
				stateJson,
				// Out-of-band version lets the webview gate BEFORE JSON.parse.
				stateVersion: state.stateVersion,
			},
			false,
		).catch((error) => {
			Logger.error("Error sending full sync state:", error)
			activeStateSubscriptions.delete(responseStream)
		})
	}
}

function recordStateSizeTelemetry(sizeBytes: number): void {
	telemetryService.captureGrpcResponseSize(sizeBytes, "cline.StateService", "subscribeToState")
}
