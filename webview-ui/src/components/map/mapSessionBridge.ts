import { MapEvent, ReportMapEventRequest } from "@shared/proto/cline/map"
import { MapServiceClient } from "../../services/grpc-client"

/** Sync basemap selection to host session (for agent map context). */
export function reportBasemapChanged(basemapId: string, basemapName: string): void {
	reportMapEvent("basemap.changed", { basemapId, basemapName })
}

/** Sync visible layer ids to host session. */
export function reportVisibleLayers(visibleLayerIds: string[]): void {
	reportMapEvent("layers.visible", { visibleLayerIds })
}

/** Fire-and-forget map telemetry to the extension host. */
export function reportMapEvent(type: string, payload: Record<string, unknown>, source = "user"): void {
	const event = MapEvent.create({
		type,
		payloadJson: JSON.stringify(payload),
		timestampMs: Date.now(),
		source,
	})
	void MapServiceClient.reportMapEvent(ReportMapEventRequest.create({ event })).catch((err) => {
		console.warn("[mapSessionBridge] reportMapEvent failed:", err)
	})
}
