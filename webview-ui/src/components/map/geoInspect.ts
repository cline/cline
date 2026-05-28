/**
 * GeoJSON normalization and point-in-feature tests for the map inspector.
 */

export interface InspectFeatureRef {
	feature: { type?: string; geometry?: unknown; properties?: Record<string, unknown> }
}

/** Normalize parsed GeoJSON into features the inspector can test. */
export function featuresFromGeoJson(geojson: unknown): InspectFeatureRef[] {
	if (!geojson || typeof geojson !== "object") {
		return []
	}
	const g = geojson as Record<string, unknown>
	const type = g.type as string | undefined

	if (type === "FeatureCollection" && Array.isArray(g.features)) {
		return (g.features as InspectFeatureRef["feature"][]).filter((f) => f?.geometry).map((feature) => ({ feature }))
	}
	if (type === "Feature" && g.geometry) {
		return [{ feature: g as InspectFeatureRef["feature"] }]
	}
	if (type && type !== "FeatureCollection" && type !== "Feature" && "coordinates" in g) {
		return [
			{
				feature: {
					type: "Feature",
					geometry: g,
					properties: {},
				},
			},
		]
	}
	return []
}

const pointInRing = (lon: number, lat: number, ring: number[][]): boolean => {
	let inside = false
	for (let j = 0, k = ring.length - 1; j < ring.length; k = j++) {
		const [x1, y1] = ring[k]
		const [x2, y2] = ring[j]
		const intersect = y1 > lat !== y2 > lat && lon < ((x2 - x1) * (lat - y1)) / (y2 - y1) + x1
		if (intersect) {
			inside = !inside
		}
	}
	return inside
}

export const pointInPolygonCoords = (lon: number, lat: number, polygon: number[][][]): boolean => {
	for (let i = 0; i < polygon.length; i++) {
		const inside = pointInRing(lon, lat, polygon[i])
		if (i === 0 && !inside) {
			return false
		}
		if (i > 0 && inside) {
			return false
		}
	}
	return true
}

export function featureContainsPoint(feature: InspectFeatureRef["feature"], lon: number, lat: number): boolean {
	const geometry = feature?.geometry as { type?: string; coordinates?: unknown } | undefined
	if (!geometry?.type || geometry.coordinates === undefined) {
		return false
	}

	const type = geometry.type
	const coords = geometry.coordinates

	if (type === "Point" && Array.isArray(coords) && coords.length >= 2) {
		return Math.abs((coords[0] as number) - lon) < 0.0001 && Math.abs((coords[1] as number) - lat) < 0.0001
	}

	if (type === "LineString" && Array.isArray(coords)) {
		const tolerance = 0.001
		const line = coords as number[][]
		for (let i = 0; i < line.length - 1; i++) {
			const [x1, y1] = line[i]
			const [x2, y2] = line[i + 1]
			const dx = x2 - x1
			const dy = y2 - y1
			const len2 = dx * dx + dy * dy
			let t = len2 === 0 ? 0 : ((lon - x1) * dx + (lat - y1) * dy) / len2
			t = Math.max(0, Math.min(1, t))
			const dist2 = (lon - (x1 + t * dx)) ** 2 + (lat - (y1 + t * dy)) ** 2
			if (dist2 < tolerance * tolerance) {
				return true
			}
		}
		return false
	}

	if (type === "Polygon" && Array.isArray(coords)) {
		return pointInPolygonCoords(lon, lat, coords as number[][][])
	}

	if (type === "MultiPoint" && Array.isArray(coords)) {
		return (coords as number[][]).some((c) => Math.abs(c[0] - lon) < 0.0001 && Math.abs(c[1] - lat) < 0.0001)
	}

	if (type === "MultiLineString" && Array.isArray(coords)) {
		const tolerance = 0.001
		return (coords as number[][][]).some((line) => {
			for (let i = 0; i < line.length - 1; i++) {
				const [x1, y1] = line[i]
				const [x2, y2] = line[i + 1]
				const dx = x2 - x1
				const dy = y2 - y1
				const len2 = dx * dx + dy * dy
				let t = len2 === 0 ? 0 : ((lon - x1) * dx + (lat - y1) * dy) / len2
				t = Math.max(0, Math.min(1, t))
				const dist2 = (lon - (x1 + t * dx)) ** 2 + (lat - (y1 + t * dy)) ** 2
				if (dist2 < tolerance * tolerance) {
					return true
				}
			}
			return false
		})
	}

	if (type === "MultiPolygon" && Array.isArray(coords)) {
		return (coords as number[][][][]).some((poly) => pointInPolygonCoords(lon, lat, poly))
	}

	return false
}

export function collectFeaturesAtPoint(
	layers: Array<{ id: string; name: string; geojson: string }>,
	visibleLayerIds: Set<string>,
	isVectorLayer: (layer: { geojson: string; layerType: string }) => boolean,
	lon: number,
	lat: number,
): Array<{ layerId: string; layerName: string; properties: Record<string, unknown>; geometry?: unknown }> {
	const clicked: Array<{ layerId: string; layerName: string; properties: Record<string, unknown>; geometry?: unknown }> = []

	for (const layer of layers) {
		if (!visibleLayerIds.has(layer.id) || !isVectorLayer(layer as { geojson: string; layerType: string })) {
			continue
		}
		try {
			const parsed = JSON.parse(layer.geojson)
			for (const { feature } of featuresFromGeoJson(parsed)) {
				if (featureContainsPoint(feature, lon, lat)) {
					clicked.push({
						layerId: layer.id,
						layerName: layer.name,
						properties: (feature.properties as Record<string, unknown>) || {},
						geometry: feature.geometry,
					})
				}
			}
		} catch (err) {
			console.error(`[geoInspect] Error parsing layer ${layer.id}:`, err)
		}
	}
	return clicked
}
