import type { MapLayer } from "@shared/proto/cline/map"

/** Approximate CONUS extent for NLDI vs MERIT snap policy. */
export function isConus(lat: number, lon: number): boolean {
	return lat >= 24 && lat <= 50 && lon >= -125 && lon <= -66
}

/** True when visible MERIT river vectors are on the map (required for reliable snap outside CONUS). */
export function hasMeritRiversOnMap(layers: MapLayer[], visibleLayerIds: Set<string>): boolean {
	return layers.some((l) => {
		if (!visibleLayerIds.has(l.id)) {
			return false
		}
		if (l.metadata?.source !== "merit") {
			return false
		}
		const t = (l.layerType ?? "").toLowerCase()
		const name = (l.name ?? "").toLowerCase()
		return t === "line" || name.includes("river") || name.includes("flowline")
	})
}

export function meritRiversRequiredMessage(): string {
	return "Outside CONUS, load MERIT rivers first (Hydrography → Load rivers for this view) so the pour point can snap to the network."
}
