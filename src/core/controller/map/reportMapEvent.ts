import { Empty } from "@shared/proto/cline/common"
import type { ReportMapEventRequest } from "@shared/proto/cline/map"
import { MapSessionView } from "@shared/proto/cline/map"
import type { Controller } from ".."

function parsePayload(json: string | undefined): Record<string, unknown> {
	if (!json?.trim()) {
		return {}
	}
	try {
		return JSON.parse(json) as Record<string, unknown>
	} catch {
		return {}
	}
}

/** Apply session-driving events before appending to the ring buffer. */
export async function reportMapEvent(controller: Controller, request: ReportMapEventRequest): Promise<Empty> {
	const event = request.event
	if (!event) {
		return Empty.create()
	}

	const svc = controller.mapSessionService
	const payload = parsePayload(event.payloadJson)

	switch (event.type) {
		case "basemap.changed": {
			const id = String(payload.basemapId ?? payload.basemap_id ?? "")
			const name = String(payload.basemapName ?? payload.basemap_name ?? id)
			if (id) {
				svc.setBasemap(id, name)
			}
			break
		}
		case "view.changed": {
			const lon = Number(payload.longitude)
			const lat = Number(payload.latitude)
			const zoom = Number(payload.zoom)
			if (Number.isFinite(lon) && Number.isFinite(lat)) {
				svc.setView(
					MapSessionView.create({
						longitude: lon,
						latitude: lat,
						zoom: Number.isFinite(zoom) ? zoom : 4,
						bearing: Number(payload.bearing) || 0,
						pitch: Number(payload.pitch) || 0,
					}),
				)
			}
			break
		}
		case "layers.visible": {
			const ids = payload.visibleLayerIds
			if (Array.isArray(ids)) {
				svc.setVisibleLayerIds(ids.map((id) => String(id)))
			}
			break
		}
		case "inspect.click": {
			const lat = Number(payload.lat)
			const lon = Number(payload.lon)
			if (Number.isFinite(lat) && Number.isFinite(lon)) {
				const props = payload.featureProperties
				svc.setLastInspect({
					lat,
					lon,
					layerName: typeof payload.layerName === "string" ? payload.layerName : undefined,
					featureProperties:
						props && typeof props === "object" && !Array.isArray(props)
							? (props as Record<string, unknown>)
							: undefined,
					visibleLayerNames: Array.isArray(payload.visibleLayerNames)
						? payload.visibleLayerNames.map(String)
						: undefined,
					featureCount: Number(payload.featureCount) || 0,
				})
			}
			break
		}
		default:
			break
	}

	svc.appendEvent(event)
	return Empty.create()
}
