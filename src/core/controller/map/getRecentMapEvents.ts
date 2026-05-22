import type { GetRecentMapEventsRequest, MapEventsResponse } from "@shared/proto/cline/map"
import { MapEventsResponse as MapEventsResponseProto } from "@shared/proto/cline/map"
import type { Controller } from ".."

export async function getRecentMapEvents(controller: Controller, request: GetRecentMapEventsRequest): Promise<MapEventsResponse> {
	const limit = request.limit > 0 ? request.limit : 20
	return MapEventsResponseProto.create({
		events: controller.mapSessionService.getRecentEvents(limit),
	})
}
