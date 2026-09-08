import { EmptyRequest, StringRequest } from "@shared/proto/cline/common"
import { State } from "@shared/proto/cline/state"
import { telemetryService } from "@/services/telemetry"
import { ExtensionState } from "@/shared/ExtensionMessage"
import { Logger } from "@/shared/services/Logger"
import { getRequestRegistry, StreamingResponseHandler } from "../grpc-handler"
import { Controller } from "../index"

/**
 * Maximum size (in bytes) for state JSON before truncation is applied.
 * 800KB threshold provides safety margin below the 1MB IPC limit.
 */
const STATE_SIZE_WARNING_THRESHOLD = 800 * 1024
const STATE_SIZE_HARD_LIMIT = 1024 * 1024

/**
 * Maximum number of messages to include in truncated state.
 * This ensures the most recent messages are preserved while reducing payload size.
 */
const MAX_MESSAGES_IN_TRUNCATED_STATE = 100

/**
 * Instance-level subscription manager for state updates.
 * Replaces the global Set with per-instance tracking to prevent
 * subscription leaks and improve cleanup reliability.
 */
class StateSubscriptionManager {
	private static instance: StateSubscriptionManager | null = null
	private subscriptions: Map<string, StreamingResponseHandler<State>> = new Map()
	private subscriptionCounter = 0

	static getInstance(): StateSubscriptionManager {
		if (!StateSubscriptionManager.instance) {
			StateSubscriptionManager.instance = new StateSubscriptionManager()
		}
		return StateSubscriptionManager.instance
	}

	/**
	 * Register a new state subscription with a unique ID.
	 * Returns the subscription ID for later cleanup.
	 */
	register(responseStream: StreamingResponseHandler<State>): string {
		const subscriptionId = `state_sub_${++this.subscriptionCounter}_${Date.now()}`
		this.subscriptions.set(subscriptionId, responseStream)

		Logger.debug(`[StateSubscriptionManager] Registered subscription: ${subscriptionId}`)
		return subscriptionId
	}

	/**
	 * Unregister a state subscription by ID.
	 */
	unregister(subscriptionId: string): void {
		if (this.subscriptions.delete(subscriptionId)) {
			Logger.debug(`[StateSubscriptionManager] Unregistered subscription: ${subscriptionId}`)
		}
	}

	/**
	 * Get all active subscriptions.
	 */
	getActiveSubscriptions(): StreamingResponseHandler<State>[] {
		return Array.from(this.subscriptions.values())
	}

	/**
	 * Get the number of active subscriptions.
	 */
	getSubscriptionCount(): number {
		return this.subscriptions.size
	}

	/**
	 * Clean up all subscriptions (called on extension deactivation).
	 */
	disposeAll(): void {
		const count = this.subscriptions.size
		this.subscriptions.clear()
		if (count > 0) {
			Logger.log(`[StateSubscriptionManager] Cleared ${count} subscriptions`)
		}
	}
}

// Export singleton instance
export const stateSubscriptionManager = StateSubscriptionManager.getInstance()

/**
 * Truncate state to fit within IPC limits by reducing message history.
 * This preserves the most recent messages while discarding older ones.
 *
 * @param state The original extension state
 * @returns Truncated state with reduced message history
 */
function truncateStateForIpc(state: ExtensionState): ExtensionState {
	// If no messages or already within limits, return as-is
	if (!state.clineMessages || state.clineMessages.length <= MAX_MESSAGES_IN_TRUNCATED_STATE) {
		return state
	}

	Logger.warn(
		`[subscribeToState] Truncating state: ${state.clineMessages.length} messages → ${MAX_MESSAGES_IN_TRUNCATED_STATE}`,
	)

	// Keep the most recent messages
	const truncatedMessages = state.clineMessages.slice(-MAX_MESSAGES_IN_TRUNCATED_STATE)

	return {
		...state,
		clineMessages: truncatedMessages,
		// Mark that messages were truncated for pagination support
		messageTruncated: true,
		totalMessageCount: state.clineMessages.length,
	}
}

/**
 * Check state size and apply truncation if necessary.
 * Returns the final state JSON and whether truncation was applied.
 *
 * @param state The extension state to serialize
 * @returns Object containing the state JSON and truncation status
 */
function prepareStateForIpc(state: ExtensionState): { stateJson: string; wasTruncated: boolean } {
	const sizeBytes = Buffer.byteLength(JSON.stringify(state), "utf8")

	// Record telemetry for all state sizes
	recordStateSizeTelemetry(sizeBytes)

	// Apply truncation if state exceeds warning threshold
	if (sizeBytes > STATE_SIZE_WARNING_THRESHOLD) {
		Logger.warn(`[subscribeToState] State size ${(sizeBytes / 1024).toFixed(1)}KB exceeds threshold, applying truncation`)
		const truncatedState = truncateStateForIpc(state)
		const truncatedJson = JSON.stringify(truncatedState)
		const truncatedSize = Buffer.byteLength(truncatedJson, "utf8")

		// Log if truncation helped but still large
		if (truncatedSize > STATE_SIZE_WARNING_THRESHOLD) {
			Logger.warn(`[subscribeToState] Truncated state still large: ${(truncatedSize / 1024).toFixed(1)}KB`)
		}

		// Hard limit warning - state may be dropped by IPC
		if (truncatedSize > STATE_SIZE_HARD_LIMIT) {
			Logger.error(
				`[subscribeToState] CRITICAL: State size ${(truncatedSize / 1024).toFixed(1)}KB exceeds hard limit! May be dropped by IPC.`,
			)
		}

		return { stateJson: truncatedJson, wasTruncated: true }
	}

	return { stateJson: JSON.stringify(state), wasTruncated: false }
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
	// Register this subscription with instance-level management
	const subscriptionId = stateSubscriptionManager.register(responseStream)

	// Register cleanup when the connection is closed
	const cleanup = () => {
		stateSubscriptionManager.unregister(subscriptionId)
	}

	// Register the cleanup function with the request registry if we have a requestId
	if (requestId) {
		getRequestRegistry().registerRequest(requestId, cleanup, { type: "state_subscription" }, responseStream)
	}

	// Send the initial state with size monitoring and truncation
	const initialState = await controller.getStateToPostToWebview()
	const { stateJson } = prepareStateForIpc(initialState)

	try {
		await responseStream(
			{
				stateJson,
				// Out-of-band version lets the webview gate BEFORE JSON.parse.
				stateVersion: initialState.stateVersion,
			},
			false, // Not the last message
		)
	} catch (error) {
		Logger.error("Error sending initial state:", error)
		stateSubscriptionManager.unregister(subscriptionId)
	}
}

/**
 * Send a state update to all active subscribers
 * @param state The state to send
 */
export async function sendStateUpdate(state: ExtensionState): Promise<void> {
	const { stateJson } = prepareStateForIpc(state)

	// Get all active subscriptions from the instance-level manager
	const activeSubscriptions = stateSubscriptionManager.getActiveSubscriptions()

	// FIRE-AND-FORGET: do not await delivery to the webview (it may be hidden/reloaded/closed
	// and postMessage can hang or resolve false). The webview reconciles convergently from
	// whatever state snapshots it receives, gated by stateVersion/epoch.
	for (const responseStream of activeSubscriptions) {
		responseStream(
			{
				stateJson,
				// Out-of-band version lets the webview gate BEFORE JSON.parse.
				stateVersion: state.stateVersion,
			},
			false, // Not the last message
		).catch((error) => {
			Logger.error("Error sending state update:", error)
			// Note: We can't easily unregister here since we don't have the subscriptionId
			// The subscription will be cleaned up when the connection closes
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

	// Get all active subscriptions from the instance-level manager
	const activeSubscriptions = stateSubscriptionManager.getActiveSubscriptions()

	for (const responseStream of activeSubscriptions) {
		responseStream(
			{
				stateJson: "", // sentinel: webview checks deltaJson first when present
				deltaJson,
			},
			false,
		).catch((error) => {
			Logger.error("Error sending state delta:", error)
			// Note: We can't easily unregister here since we don't have the subscriptionId
			// The subscription will be cleaned up when the connection closes
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
	const { stateJson } = prepareStateForIpc(state)

	// Get all active subscriptions from the instance-level manager
	const activeSubscriptions = stateSubscriptionManager.getActiveSubscriptions()

	for (const responseStream of activeSubscriptions) {
		responseStream(
			{
				stateJson,
				// Out-of-band version lets the webview gate BEFORE JSON.parse.
				stateVersion: state.stateVersion,
			},
			false,
		).catch((error) => {
			Logger.error("Error sending full sync state:", error)
			// Note: We can't easily unregister here since we don't have the subscriptionId
			// The subscription will be cleaned up when the connection closes
		})
	}
}

function recordStateSizeTelemetry(sizeBytes: number): void {
	telemetryService.captureGrpcResponseSize(sizeBytes, "cline.StateService", "subscribeToState")

	// Log state size metrics for monitoring
	if (sizeBytes > STATE_SIZE_WARNING_THRESHOLD) {
		Logger.warn(`[subscribeToState] Large state payload: ${(sizeBytes / 1024).toFixed(1)}KB`)
	}

	// Track subscription count for diagnostics
	const subscriptionCount = stateSubscriptionManager.getSubscriptionCount()
	if (subscriptionCount > 1) {
		Logger.debug(`[subscribeToState] Active subscriptions: ${subscriptionCount}`)
	}
}
