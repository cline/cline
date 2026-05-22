import { EmptyRequest } from "@shared/proto/cline/common"
import type { MapSessionState } from "@shared/proto/cline/map"
import { getRequestRegistry, type StreamingResponseHandler } from "@/core/controller/grpc-handler"
import type { Controller } from ".."

const activeSubscriptions = new Set<StreamingResponseHandler<MapSessionState>>()

export async function subscribeToMapSession(
	controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<MapSessionState>,
	requestId?: string,
): Promise<void> {
	await controller.refreshMapSessionWorkspaceRoot()
	activeSubscriptions.add(responseStream)

	const unsubscribe = controller.mapSessionService.subscribeToSession(async (state) => {
		if (!activeSubscriptions.has(responseStream)) {
			return
		}
		try {
			const full = controller.mapSessionService.buildSnapshot(controller.getMapLayers())
			full.activeRoi = state.activeRoi ?? full.activeRoi
			full.view = state.view ?? full.view
			full.visibleLayerIds = state.visibleLayerIds?.length ? state.visibleLayerIds : full.visibleLayerIds
			await responseStream(full, false)
		} catch (error) {
			console.error("[subscribeToMapSession] stream error:", error)
			activeSubscriptions.delete(responseStream)
			unsubscribe()
		}
	})

	const cleanup = () => {
		activeSubscriptions.delete(responseStream)
		unsubscribe()
	}
	if (requestId) {
		getRequestRegistry().registerRequest(requestId, cleanup, { type: "map_session_subscription" }, responseStream)
	}

	try {
		await responseStream(controller.mapSessionService.buildSnapshot(controller.getMapLayers()), false)
	} catch (error) {
		console.error("[subscribeToMapSession] initial send failed:", error)
		cleanup()
	}
}
