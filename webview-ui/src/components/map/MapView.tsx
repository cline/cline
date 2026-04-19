import type { MapViewState } from "@deck.gl/core"
import { BitmapLayer, GeoJsonLayer } from "@deck.gl/layers"
import DeckGL from "@deck.gl/react"
import type { MapLayer } from "@shared/proto/cline/map"
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Map } from "react-map-gl"
import { useMapContext } from "../../context/MapContext"
import { BASE_MAP_STYLES, BaseMapSelector } from "./BaseMapSelector"
import { LayerList } from "./LayerList"

const MAPBOX_TOKEN = (import.meta.env.VITE_MAPBOX_TOKEN || "").trim()

type BoundingBox = [number, number, number, number]

const createRasterStyle = (tileUrl: string, attribution: string = ""): any => ({
	version: 8,
	sources: {
		"raster-tiles": {
			type: "raster",
			tiles: [tileUrl],
			tileSize: 256,
			attribution,
		},
	},
	layers: [
		{
			id: "simple-tiles",
			type: "raster",
			source: "raster-tiles",
			minzoom: 0,
			maxzoom: 22,
		},
	],
})

const isCoordinatePair = (value: unknown): value is [number, number] =>
	Array.isArray(value) &&
	value.length >= 2 &&
	typeof value[0] === "number" &&
	typeof value[1] === "number" &&
	Number.isFinite(value[0]) &&
	Number.isFinite(value[1])

const collectCoordinates = (value: unknown, target: [number, number][]): void => {
	if (isCoordinatePair(value)) {
		target.push([value[0], value[1]])
		return
	}

	if (!Array.isArray(value)) {
		return
	}

	value.forEach((entry) => collectCoordinates(entry, target))
}

const getBoundsFromGeojsonString = (geojsonString: string): BoundingBox | undefined => {
	if (!geojsonString) {
		return undefined
	}

	try {
		const parsed = JSON.parse(geojsonString)
		const coordinates: [number, number][] = []

		if (parsed?.type === "FeatureCollection" && Array.isArray(parsed.features)) {
			parsed.features.forEach((feature: any) => collectCoordinates(feature?.geometry?.coordinates, coordinates))
		} else if (parsed?.type === "Feature") {
			collectCoordinates(parsed?.geometry?.coordinates, coordinates)
		} else if (parsed?.type === "GeometryCollection" && Array.isArray(parsed.geometries)) {
			parsed.geometries.forEach((geometry: any) => collectCoordinates(geometry?.coordinates, coordinates))
		} else {
			collectCoordinates(parsed?.coordinates, coordinates)
		}

		if (coordinates.length === 0) {
			return undefined
		}

		const longitudes = coordinates.map(([longitude]) => longitude)
		const latitudes = coordinates.map(([, latitude]) => latitude)

		return [Math.min(...longitudes), Math.min(...latitudes), Math.max(...longitudes), Math.max(...latitudes)]
	} catch (error) {
		console.error("Error parsing GeoJSON bounds:", error)
		return undefined
	}
}

const mergeBounds = (allBounds: BoundingBox[]): BoundingBox | undefined => {
	if (allBounds.length === 0) {
		return undefined
	}

	return allBounds.reduce(
		(acc, current) => [
			Math.min(acc[0], current[0]),
			Math.min(acc[1], current[1]),
			Math.max(acc[2], current[2]),
			Math.max(acc[3], current[3]),
		],
		allBounds[0],
	)
}

const fitViewStateToBounds = (
	bounds: BoundingBox,
	dimensions: { width: number; height: number },
	currentViewState: MapViewState,
): MapViewState => {
	const [minLon, minLat, maxLon, maxLat] = bounds
	const safeWidth = Math.max(200, dimensions.width * 0.82) // 18% padding each side
	const safeHeight = Math.max(200, dimensions.height * 0.82)

	const lonDelta = Math.max(0.0001, maxLon - minLon)
	const latDelta = Math.max(0.0001, maxLat - minLat)

	const zoomX = Math.log2((safeWidth * 360) / (lonDelta * 512))
	const zoomY = Math.log2((safeHeight * 180) / (latDelta * 512))
	const zoom = Math.max(1, Math.min(16, Math.min(zoomX, zoomY)))

	return {
		...currentViewState,
		longitude: (minLon + maxLon) / 2,
		latitude: (minLat + maxLat) / 2,
		zoom: Number.isFinite(zoom) ? zoom : currentViewState.zoom,
		pitch: 0,
		bearing: 0,
	}
}

interface MapViewProps {
	width?: number
	height?: number
	mapStyle?: string
}

export const MapView: React.FC<MapViewProps> = ({ width, height, mapStyle = "dark" }) => {
	const { layers } = useMapContext()
	const knownLayerIdsRef = useRef<Set<string>>(new Set())
	const lastAutoFitKeyRef = useRef<string>("")

	const [dimensions, setDimensions] = useState({
		width: width || window.innerWidth,
		height: height || window.innerHeight - 100,
	})

	const [viewState, setViewState] = useState<MapViewState>({
		longitude: -95,
		latitude: 40,
		zoom: 4,
		pitch: 0,
		bearing: 0,
	})

	const [visibleLayerIds, setVisibleLayerIds] = useState<Set<string>>(
		new Set(layers.filter((layer) => layer.visible !== false).map((layer) => layer.id)),
	)

	const hasMapboxToken = MAPBOX_TOKEN.length > 0
	const defaultBaseMap = mapStyle === "dark" ? "usgs-topo" : "usgs-topo"
	const [selectedBaseMap, setSelectedBaseMap] = useState<string>(defaultBaseMap)

	const computedMapStyle = useMemo(() => {
		const baseMapConfig = BASE_MAP_STYLES.find((style) => style.id === selectedBaseMap)
		const fallbackStyle = "usgs-topo"

		if (!baseMapConfig) {
			const fallback = BASE_MAP_STYLES.find((style) => style.id === fallbackStyle)
			return fallback ? createRasterStyle(fallback.url, fallback.attribution) : createRasterStyle(BASE_MAP_STYLES[0].url)
		}

		if (baseMapConfig.requiresToken && !hasMapboxToken) {
			const fallback = BASE_MAP_STYLES.find((style) => style.id === fallbackStyle)
			return fallback ? createRasterStyle(fallback.url, fallback.attribution) : createRasterStyle(BASE_MAP_STYLES[0].url)
		}

		if (baseMapConfig.url.startsWith("mapbox://")) {
			return baseMapConfig.url
		}

		return createRasterStyle(baseMapConfig.url, baseMapConfig.attribution)
	}, [selectedBaseMap, mapStyle, hasMapboxToken])

	useEffect(() => {
		setSelectedBaseMap((current) => {
			const selectedStyle = BASE_MAP_STYLES.find((style) => style.id === current)
			if (selectedStyle?.requiresToken && !hasMapboxToken) {
				return defaultBaseMap
			}
			return current
		})
	}, [defaultBaseMap, hasMapboxToken])

	useEffect(() => {
		const previousLayerIds = knownLayerIdsRef.current

		setVisibleLayerIds((previousVisibleLayers) => {
			const nextVisibleLayers = new Set<string>()

			layers.forEach((layer) => {
				if (previousVisibleLayers.has(layer.id)) {
					nextVisibleLayers.add(layer.id)
					return
				}

				if (!previousLayerIds.has(layer.id) && layer.visible !== false) {
					nextVisibleLayers.add(layer.id)
				}
			})

			return nextVisibleLayers
		})

		knownLayerIdsRef.current = new Set(layers.map((layer) => layer.id))
	}, [layers])

	const handleVisibilityChange = (layerId: string, visible: boolean) => {
		setVisibleLayerIds((previousVisibleLayers) => {
			const nextVisibleLayers = new Set(previousVisibleLayers)
			if (visible) {
				nextVisibleLayers.add(layerId)
			} else {
				nextVisibleLayers.delete(layerId)
			}
			return nextVisibleLayers
		})
	}

	useEffect(() => {
		const handleResize = () => {
			setDimensions({
				width: width || window.innerWidth,
				height: height || window.innerHeight - 100,
			})
		}

		window.addEventListener("resize", handleResize)
		return () => window.removeEventListener("resize", handleResize)
	}, [width, height])

	useEffect(() => {
		if (layers.length === 0) {
			return
		}

		const visibleKey = Array.from(visibleLayerIds).sort().join("|")
		const autoFitKey = `${layers
			.map((layer) => layer.id)
			.sort()
			.join("|")}::${visibleKey}`

		if (lastAutoFitKeyRef.current === autoFitKey) {
			return
		}

		const targetLayers = layers.filter((layer) => visibleLayerIds.has(layer.id))
		const layersToFit = targetLayers.length > 0 ? targetLayers : layers
		const bounds = mergeBounds(
			layersToFit
				.map((layer) => getBoundsFromGeojsonString(layer.geojson))
				.filter((value): value is BoundingBox => value !== undefined),
		)

		if (!bounds) {
			return
		}

		lastAutoFitKeyRef.current = autoFitKey
		setViewState((previousViewState) => fitViewStateToBounds(bounds, dimensions, previousViewState))
	}, [layers, visibleLayerIds, dimensions])

	const handleZoomToLayer = (layer: MapLayer) => {
		const bounds = getBoundsFromGeojsonString(layer.geojson)
		if (!bounds) {
			return
		}

		setViewState((previousViewState) => fitViewStateToBounds(bounds, dimensions, previousViewState))
	}

	// Tooltip shown on hover — surfaces feature properties + layer name
	const getTooltip = useCallback(
		({ object, layer: deckLayer }: any) => {
			if (!object) {
				return null
			}
			const matched = layers.find((l) => l.id === deckLayer?.id)
			const name = matched?.name || deckLayer?.id || ""
			const props = (object.properties || {}) as Record<string, unknown>
			const entries = Object.entries(props).filter(([k]) => !k.startsWith("_"))
			if (!name && entries.length === 0) {
				return null
			}
			const shown = entries.slice(0, 8)
			const extra = entries.length - shown.length
			return {
				html: [
					'<div style="font-size:12px;line-height:1.5;max-width:260px">',
					name ? `<strong style="display:block;margin-bottom:4px;font-size:13px">${name}</strong>` : "",
					shown.map(([k, v]) => `<div><b>${k}:</b> ${String(v ?? "—")}</div>`).join(""),
					extra > 0 ? `<div style="opacity:0.6;margin-top:4px">+${extra} more properties</div>` : "",
					"</div>",
				].join(""),
				style: { padding: "8px 10px", borderRadius: "4px" },
			}
		},
		[layers],
	)

	const hexToRgb = (hex: string): [number, number, number] => {
		const parsedHex = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
		return parsedHex ? [parseInt(parsedHex[1], 16), parseInt(parsedHex[2], 16), parseInt(parsedHex[3], 16)] : [0, 102, 204]
	}

	const deckLayers = useMemo(
		() =>
			layers
				.filter((layer) => visibleLayerIds.has(layer.id))
				.map((layer) => {
					try {
						// Raster layers — rendered as BitmapLayer using the pre-encoded data URL
						if (layer.layerType === "raster") {
							const dataUrl = layer.metadata?.raster_data_url ?? ""
							const boundsRaw = layer.metadata?.raster_bounds
							if (!dataUrl || !boundsRaw) {
								return null
							}
							const bounds = JSON.parse(boundsRaw) as [number, number, number, number]
							const opacity = parseFloat(layer.metadata?.raster_opacity ?? "0.75")
							return new BitmapLayer({
								id: layer.id,
								image: dataUrl,
								bounds, // [west, south, east, north]
								opacity,
								pickable: false,
							})
						}

						// Vector layers — GeoJsonLayer
						const geojson = JSON.parse(layer.geojson)
						const style = layer.style

						const fillColor = style?.fillColor ? hexToRgb(style.fillColor) : [0, 102, 204]
						const strokeColor = style?.color ? hexToRgb(style.color) : [0, 51, 102]
						const fillOpacity = style?.fillOpacity !== undefined ? style.fillOpacity * 255 : 153
						const strokeWidth = style?.weight || 2

						return new GeoJsonLayer({
							id: layer.id,
							data: geojson,
							pickable: true,
							stroked: true,
							filled: true,
							extruded: false,
							lineWidthUnits: "pixels" as const,
							lineWidthMinPixels: 1,
							lineWidthMaxPixels: 20,
							getLineWidth: strokeWidth,
							getFillColor: [fillColor[0], fillColor[1], fillColor[2], fillOpacity],
							getLineColor: [strokeColor[0], strokeColor[1], strokeColor[2], 255],
							pointRadiusUnits: "pixels" as const,
							pointRadiusMinPixels: 3,
							pointRadiusMaxPixels: 16,
							getPointRadius: 5,
						})
					} catch (error) {
						console.error(`Error creating layer ${layer.id}:`, error)
						return null
					}
				})
				.filter(Boolean) as any[],
		[layers, visibleLayerIds],
	)

	return (
		<div
			className="map-view-container"
			style={{
				width: dimensions.width,
				height: dimensions.height,
				position: "relative",
			}}>
			{layers.length === 0 ? (
				<div
					style={{
						width: "100%",
						height: "100%",
						background: mapStyle === "dark" ? "#1a1a2e" : "#f5f5f5",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						flexDirection: "column",
						gap: "20px",
						color: mapStyle === "dark" ? "#ffffff" : "#000000",
					}}>
					<div style={{ fontSize: "48px" }}>🗺️</div>
					<h2>AI-Hydro Map View</h2>
					<p>No layers to display</p>
					<div style={{ fontSize: "12px", opacity: 0.7, textAlign: "center" }}>
						<p>Delineate a watershed or add map layers to visualize data</p>
						<p>
							Map dimensions: {dimensions.width}x{dimensions.height}
						</p>
					</div>
				</div>
			) : (
				<>
					<DeckGL
						controller={true}
						getTooltip={getTooltip}
						layers={deckLayers}
						onViewStateChange={({ viewState: nextViewState }: { viewState: MapViewState }) =>
							setViewState(nextViewState)
						}
						style={{ position: "relative" }}
						viewState={viewState}>
						<Map
							key={selectedBaseMap}
							mapboxAccessToken={MAPBOX_TOKEN}
							mapStyle={computedMapStyle}
							onError={(error) => console.error("[MapView] Map error:", error)}
							style={{ width: "100%", height: "100%" }}
						/>
					</DeckGL>

					<BaseMapSelector
						currentStyle={selectedBaseMap}
						hasMapboxToken={hasMapboxToken}
						mapStyle={mapStyle === "dark" ? "dark" : "light"}
						onStyleChange={setSelectedBaseMap}
					/>
				</>
			)}

			<LayerList
				mapStyle={mapStyle}
				onVisibilityChange={handleVisibilityChange}
				onZoomToLayer={handleZoomToLayer}
				visibleLayerIds={visibleLayerIds}
			/>
		</div>
	)
}

export default MapView
