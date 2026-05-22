import type { SaveRoiToWorkspaceRequest, SaveRoiToWorkspaceResponse } from "@shared/proto/cline/map"
import { MapLayer, MapLayerStyle, SaveRoiToWorkspaceResponse as SaveRoiToWorkspaceResponseProto } from "@shared/proto/cline/map"
import type { Controller } from ".."

export async function saveRoiToWorkspace(
	controller: Controller,
	request: SaveRoiToWorkspaceRequest,
): Promise<SaveRoiToWorkspaceResponse> {
	await controller.refreshMapSessionWorkspaceRoot()

	// Draw-tool path: save to vectors/ and register as a normal map layer (not global ROI).
	if (request.roi?.geojson?.trim()) {
		const result = await controller.mapSessionService.saveGeometryToWorkspace(
			request.name || request.roi.name || "drawn",
			request.roi.geojson,
		)
		const layerId = `workspace_${result.workspacePath.replace(/[^a-zA-Z0-9]/g, "_")}`
		let layerType: "polygon" | "line" | "point" = "polygon"
		try {
			const parsed = JSON.parse(request.roi.geojson) as { geometry?: { type?: string } }
			const g = parsed.geometry?.type
			if (g === "LineString" || g === "MultiLineString") {
				layerType = "line"
			} else if (g === "Point" || g === "MultiPoint") {
				layerType = "point"
			}
		} catch {
			/* default polygon */
		}
		controller.addMapLayer(
			MapLayer.create({
				id: layerId,
				name: request.roi.name || request.name || "Drawn vector",
				geojson: request.roi.geojson,
				layerType,
				visible: true,
				style: MapLayerStyle.create({
					fillColor: "#0e639c",
					fillOpacity: 0.25,
					color: "#0e639c",
					strokeColor: "#0e639c",
					strokeWidth: 2,
					weight: 2,
					opacity: 1,
				}),
				metadata: {
					source: "workspace",
					path: result.workspacePath,
					createdBy: "map_draw",
				},
			}),
		)
		return SaveRoiToWorkspaceResponseProto.create({
			workspacePath: result.workspacePath,
			activePointerPath: "",
		})
	}

	const result = await controller.mapSessionService.saveRoiToWorkspace(request.name || "basin", request.roi)
	return SaveRoiToWorkspaceResponseProto.create({
		workspacePath: result.workspacePath,
		activePointerPath: result.activePointerPath,
	})
}
