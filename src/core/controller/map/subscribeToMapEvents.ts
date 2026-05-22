import { EmptyRequest } from "@shared/proto/cline/common"
import type { MapEvent } from "@shared/proto/cline/map"
import { getRequestRegistry, type StreamingResponseHandler } from "@/core/controller/grpc-handler"
import type { Controller } from ".."

const activeSubscriptions = new Set<StreamingResponseHandler<MapEvent>>()

export async function subscribeToMapEvents(
	controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<MapEvent>,
	requestId?: string,
): Promise<void> {
	activeSubscriptions.add(responseStream)

	const unsubscribe = controller.mapSessionService.subscribeToEvents(async (event) => {
		if (!activeSubscriptions.has(responseStream)) {
			return
		}
		try {
			await responseStream(event, false)
		} catch (error) {
			console.error("[subscribeToMapEvents] stream error:", error)
			activeSubscriptions.delete(responseStream)
			unsubscribe()
		}
	})

	const cleanup = () => {
		activeSubscriptions.delete(responseStream)
		unsubscribe()
	}
	if (requestId) {
		getRequestRegistry().registerRequest(requestId, cleanup, { type: "map_events_subscription" }, responseStream)
	}

	for (const event of controller.mapSessionService.getRecentEvents(20)) {
		try {
			await responseStream(event, false)
		} catch {
			cleanup()
			return
		}
	}
}
