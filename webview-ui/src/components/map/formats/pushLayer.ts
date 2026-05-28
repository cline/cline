/**
 * Push a normalized LayerSpec through the MapService gRPC channel.
 *
 * Vector layers travel as MapLayer { geojson, style, ... }.
 * Raster layers reuse the same MapLayer message but encode bounds/data-url/opacity
 * in the metadata map (the existing MapEventWatcher contract).
 */

import { AddMapLayerRequest, MapLayer, MapLayerStyle } from "@shared/proto/cline/map"
import { MapServiceClient } from "../../../services/grpc-client"
import { dataUrlToImage, rasterCache } from "./rasterCache"
import type { LayerSpec } from "./types"

function sourceMetadata(spec: LayerSpec): Record<string, string> {
	const source = spec.source
	if (!source) {
		return {}
	}
	const out: Record<string, string> = {
		source_uri: source.uri ?? "",
		source_path: source.path ?? "",
		source_display_path: source.displayPath ?? source.path ?? source.uri ?? "",
		source_format: source.format ?? spec.metadata?.format ?? "",
		source_loaded_at_utc: new Date().toISOString(),
		source_status: "current",
	}
	if (source.mtimeMs !== undefined) out.source_mtime_ms = String(source.mtimeMs)
	if (source.sizeBytes !== undefined) out.source_size_bytes = String(source.sizeBytes)
	if (source.remoteUrl) out.source_remote_url = source.remoteUrl
	if (source.derivedFrom) out.source_derived_from = source.derivedFrom
	return Object.fromEntries(Object.entries(out).filter(([, value]) => value !== ""))
}

export async function pushLayerSpec(spec: LayerSpec): Promise<void> {
	if (spec.kind === "vector") {
		const style = MapLayerStyle.create({
			fillColor: spec.style?.fillColor ?? "#0066CC",
			fillOpacity: spec.style?.fillOpacity ?? 0.4,
			strokeColor: spec.style?.strokeColor ?? "#003399",
			color: spec.style?.strokeColor ?? "#003399",
			strokeWidth: spec.style?.strokeWidth ?? 2,
			weight: spec.style?.strokeWidth ?? 2,
			opacity: 1,
		})
		const layer = MapLayer.create({
			id: spec.id,
			name: spec.name,
			geojson: spec.geojson,
			layerType: "polygon",
			style,
			visible: true,
			metadata: {
				...(spec.metadata ?? {}),
				...sourceMetadata(spec),
				source: "user",
				addedAt: new Date().toISOString(),
			},
		})
		await MapServiceClient.addMapLayer(AddMapLayerRequest.create({ layer }))
		return
	}

	// Raster — the image is several MB and the VS Code webview CSP forbids
	// `data:` in `connect-src`, which breaks deck.gl's fetch-based loader.
	// Pre-decode the data URL into an HTMLImageElement so BitmapLayer gets a
	// ready-to-use texture source. Held in rasterCache (module singleton);
	// only a tiny sentinel travels through gRPC.
	const image = await dataUrlToImage(spec.dataUrl)
	rasterCache.set(spec.id, {
		image,
		bounds: spec.bounds as [number, number, number, number],
		colormap: spec.colormap ?? "viridis",
		rawPixels: spec.rawPixels,
	})

	const layer = MapLayer.create({
		id: spec.id,
		name: spec.name,
		geojson: "",
		layerType: "raster",
		visible: true,
		metadata: {
			...(spec.metadata ?? {}),
			...sourceMetadata(spec),
			source: "user",
			addedAt: new Date().toISOString(),
			raster_bounds: JSON.stringify(spec.bounds),
			raster_opacity: String(spec.opacity ?? 0.85),
			raster_colormap: spec.colormap ?? "viridis",
			raster_recolorable: spec.rawPixels ? "true" : "false",
			// Store the data URL so the raster survives extension reloads.
			// Python-pushed rasters use the same field (MapEventWatcher sets it);
			// the preload useEffect in MapView decodes whichever is present.
			raster_data_url: spec.dataUrl,
			raster_cached: "1",
		},
	})
	await MapServiceClient.addMapLayer(AddMapLayerRequest.create({ layer }))
}
