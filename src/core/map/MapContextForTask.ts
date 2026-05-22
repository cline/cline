import type { Controller } from "@core/controller"
import type { MapEvent, MapSessionView } from "@shared/proto/cline/map"

const MAX_CONTEXT_BYTES = 2048

function formatView(view: MapSessionView): string {
	const lat = view.latitude
	const lon = view.longitude
	const zoom = view.zoom
	const latStr = Number.isFinite(lat) ? `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? "N" : "S"}` : "?"
	const lonStr = Number.isFinite(lon) ? `${Math.abs(lon).toFixed(4)}°${lon >= 0 ? "E" : "W"}` : "?"
	const zoomStr = Number.isFinite(zoom) ? zoom.toFixed(2) : "?"
	return `${latStr}, ${lonStr} · zoom ${zoomStr}`
}

function summarizeEvent(event: MapEvent): string {
	const payload = (() => {
		if (!event.payloadJson) {
			return {}
		}
		try {
			return JSON.parse(event.payloadJson) as Record<string, unknown>
		} catch {
			return {}
		}
	})()

	switch (event.type) {
		case "basemap.changed":
			return `basemap → ${String(payload.basemapName ?? payload.basemapId ?? "")}`
		case "user.file_saved":
			return `saved vector ${String(payload.path ?? "")}`
		case "user.file_loaded":
			return `loaded ${String(payload.name ?? payload.path ?? "file")}`
		case "layer.visibility":
			return `toggled ${String(payload.layerId ?? "layer")}`
		case "inspect.click":
			return `map click (${String(payload.featureCount ?? 0)} features)`
		case "delineation.requested": {
			const lat = payload.lat
			const lon = payload.lon
			if (typeof lat === "number" && typeof lon === "number") {
				return `delineate outlet at ${lat.toFixed(5)}°, ${lon.toFixed(5)}° — use delineate_watershed_from_point`
			}
			return "delineation requested at map click"
		}
		case "delineation.started":
			return "watershed delineation started"
		case "delineation.completed":
			return `delineation done (${String(payload.method_used ?? "")}, ${String(payload.area_km2 ?? "")} km²)`
		case "view.changed":
			return "panned/zoomed map"
		case "command.fit_extent":
			return "fit extent requested"
		default:
			return event.type || "map activity"
	}
}

function hasMapSessionSignal(controller: Controller): boolean {
	const svc = controller.mapSessionService
	return Boolean(
		svc.getBasemap() ||
			svc.getView() ||
			controller.getMapLayers().length > 0 ||
			controller.getWorkspaceGeoJsonFiles().length > 0 ||
			svc.getRecentEvents(1).length > 0,
	)
}

/**
 * Compact map context for the agent: basemap, view, layers, workspace files, recent actions.
 */
export function buildMapContextForTask(controller: Controller): string {
	if (!hasMapSessionSignal(controller)) {
		return ""
	}

	const svc = controller.mapSessionService
	const events = svc.getRecentEvents(8)
	const layers = controller.getMapLayers()
	const visible = layers.filter((l) => l.visible !== false)
	const hiddenCount = layers.length - visible.length
	const workspaceFiles = controller.getWorkspaceGeoJsonFiles()

	const lines: string[] = ["## Map context"]

	const basemap = svc.getBasemap()
	if (basemap) {
		lines.push(`Active basemap: ${basemap.name} (id: ${basemap.id})`)
	}

	const view = svc.getView()
	if (view) {
		lines.push(`Map view: ${formatView(view)}`)
	}

	if (layers.length > 0) {
		lines.push(
			`Map layers: ${layers.length} total (${visible.length} visible${hiddenCount > 0 ? `, ${hiddenCount} hidden` : ""})`,
		)
	}

	if (visible.length > 0) {
		const names = visible
			.slice(0, 8)
			.map((l) => {
				const path = l.metadata?.path
				const kind = l.layerType || "vector"
				return path ? `${l.name} [${kind}, ${path}]` : `${l.name} [${kind}]`
			})
			.join("; ")
		const more = visible.length > 8 ? ` (+${visible.length - 8} more)` : ""
		lines.push(`Visible: ${names}${more}`)
	}

	const fileLines = workspaceFiles
		.slice(0, 10)
		.map((f) => f.relativePath)
		.join(", ")
	if (fileLines) {
		const more = workspaceFiles.length > 10 ? ` (+${workspaceFiles.length - 10} more)` : ""
		lines.push(`Workspace geo files: ${fileLines}${more}`)
	}

	if (events.length > 0) {
		const recent = events
			.slice(-5)
			.map((e) => `${e.source || "user"}: ${summarizeEvent(e)}`)
			.join("; ")
		lines.push(`Recent map activity: ${recent}`)
	}

	const inspect = svc.getLastInspect()
	if (inspect) {
		lines.push(
			`Last map click: ${inspect.lat.toFixed(5)}°, ${inspect.lon.toFixed(5)}° (${inspect.featureCount ?? 0} features)`,
		)
		if (inspect.layerName) {
			lines.push(`Selected layer: ${inspect.layerName}`)
		}
		if (inspect.featureProperties && Object.keys(inspect.featureProperties).length > 0) {
			const props = Object.entries(inspect.featureProperties)
				.filter(([k]) => !k.startsWith("_"))
				.slice(0, 6)
				.map(([k, v]) => `${k}=${v}`)
				.join(", ")
			lines.push(`Feature attrs: ${props}`)
		}
	}

	let block = lines.join("\n")
	if (block.length > MAX_CONTEXT_BYTES) {
		block = `${block.slice(0, MAX_CONTEXT_BYTES - 3)}...`
	}
	return `\n\n${block}`
}
