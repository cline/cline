import type { ProjectGraph as DagProjectGraph } from "@services/dag/types"
import { EmptyRequest } from "@shared/proto/beadsmith/common"
import { DagUpdateEvent, DagUpdateType } from "@shared/proto/beadsmith/dag"
import { Logger } from "@/shared/services/Logger"
import { getRequestRegistry, StreamingResponseHandler } from "../grpc-handler"
import { Controller } from "../index"
import { convertSummary } from "./dag-conversions"

// Keep track of active DAG update subscriptions
const activeDagUpdateSubscriptions = new Set<StreamingResponseHandler<DagUpdateEvent>>()

// Keep track of whether we've registered the bridge event handlers
let bridgeEventHandlersRegistered = false

/**
 * Subscribe to DAG update events
 * @param controller The controller instance
 * @param _request The empty request
 * @param responseStream The streaming response handler
 * @param requestId The ID of the request (passed by the gRPC handler)
 */
export async function subscribeToDagUpdates(
	controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<DagUpdateEvent>,
	requestId?: string,
): Promise<void> {
	// Add this subscription to the active subscriptions
	activeDagUpdateSubscriptions.add(responseStream)

	// Register cleanup when the connection is closed
	const cleanup = () => {
		activeDagUpdateSubscriptions.delete(responseStream)
	}

	// Register the cleanup function with the request registry if we have a requestId
	if (requestId) {
		getRequestRegistry().registerRequest(requestId, cleanup, { type: "dag_update_subscription" }, responseStream)
	}

	// Wire up DagBridge events if not already done
	if (!bridgeEventHandlersRegistered) {
		const dagBridge = controller.getDagBridge()
		if (dagBridge) {
			dagBridge.on("graphUpdated", (graph: DagProjectGraph) => {
				void sendGraphUpdatedEvent(graph)
			})
			bridgeEventHandlersRegistered = true
			Logger.debug("[subscribeToDagUpdates] Registered DagBridge event handlers")
		}
	}
}

/**
 * Send a graph updated event based on a ProjectGraph from the DAG bridge
 */
async function sendGraphUpdatedEvent(graph: DagProjectGraph): Promise<void> {
	// Extract affected files from the graph nodes
	const affectedFiles = [...new Set(graph.nodes.map((n) => n.filePath))]

	const event = DagUpdateEvent.create({
		type: DagUpdateType.DAG_UPDATE_FULL_ANALYSIS,
		affectedFiles,
		summary: graph.summary ? convertSummary(graph.summary) : undefined,
	})

	await sendDagUpdateEvent(event)
}

/**
 * Send a DAG update event to all active subscribers
 * @param event The DagUpdateEvent to send
 */
export async function sendDagUpdateEvent(event: DagUpdateEvent): Promise<void> {
	// Send the event to all active subscribers
	const promises = Array.from(activeDagUpdateSubscriptions).map(async (responseStream) => {
		try {
			await responseStream(
				event,
				false, // Not the last message
			)
		} catch (error) {
			Logger.error("Error sending DAG update event:", error)
			// Remove the subscription if there was an error
			activeDagUpdateSubscriptions.delete(responseStream)
		}
	})

	await Promise.all(promises)
}

/**
 * Send an incremental update event
 * @param changedFiles Files that were changed
 * @param deletedFiles Files that were deleted
 */
export async function sendIncrementalUpdateEvent(changedFiles: string[], deletedFiles: string[]): Promise<void> {
	const event = DagUpdateEvent.create({
		type: DagUpdateType.DAG_UPDATE_INCREMENTAL,
		affectedFiles: [...changedFiles, ...deletedFiles],
	})

	await sendDagUpdateEvent(event)
}
