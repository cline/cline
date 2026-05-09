import type { MapViewState } from "@deck.gl/core"
import { TileLayer } from "@deck.gl/geo-layers"
import { BitmapLayer, GeoJsonLayer } from "@deck.gl/layers"
import DeckGL from "@deck.gl/react"
import type { MapLayer } from "@shared/proto/cline/map"
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useMapContext } from "../../context/MapContext"
import { BASE_MAP_STYLES } from "./BaseMapSelector"
import { loadAndPushFiles } from "./formats"
import { applyColormap, dataUrlToImage, rasterCache, rasterRecolorInFlight } from "./formats/rasterCache"
import { MapStatusBar } from "./MapStatusBar"
import { MapToolRibbon } from "./MapToolRibbon"
import { loadMapWorkspace, saveMapWorkspace } from "./mapWorkspace"

type BoundingBox = [number, number, number, number]

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

const getRasterBoundsFromLayer = (
	layer: { metadata?: Record<string, string> },
	cache: typeof rasterCache,
): BoundingBox | undefined => {
	const cached = cache.get((layer as any).id)
	if (cached?.bounds) return cached.bounds
	const raw = layer.metadata?.raster_bounds
	if (!raw) return undefined
	try {
		const b = JSON.parse(raw) as [number, number, number, number]
		if (b.length === 4 && b.every((v) => Number.isFinite(v))) return b
	} catch {
		/* ignore */
	}
	return undefined
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
	const safeWidth = Math.max(200, dimensions.width * 0.82)
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

const DEFAULT_VIEW: MapViewState = {
	longitude: -95,
	latitude: 40,
	zoom: 4,
	pitch: 0,
	bearing: 0,
}

interface MapViewProps {
	mapStyle?: string
}

export const MapView: React.FC<MapViewProps> = ({ mapStyle = "dark" }) => {
	const { layers } = useMapContext()
	const knownLayerIdsRef = useRef<Set<string>>(new Set())
	const lastAutoFitKeyRef = useRef<string>("")
	const containerRef = useRef<HTMLDivElement | null>(null)

	// Custom layer render order (user can drag-reorder in the panel).
	// Layers later in the deck.gl array render on top of earlier ones.
	const [layerOrder, setLayerOrder] = useState<string[]>([])

	// Bumped after each successful raster preload so dataLayers recomputes.
	// (rasterCache is a module singleton, not React state — we need to trigger
	// re-renders manually after async preloads complete.)
	const [rasterReadyTick, setRasterReadyTick] = useState(0)

	// Persistent state — restore on mount, save on change
	const persisted = useMemo(() => loadMapWorkspace(), [])
	const [selectedBaseMap, setSelectedBaseMap] = useState<string>(persisted.basemap ?? "usgs-topo")
	const [viewState, setViewState] = useState<MapViewState>(persisted.viewState ?? DEFAULT_VIEW)
	const [visibleLayerIds, setVisibleLayerIds] = useState<Set<string>>(
		new Set(persisted.visibleLayerIds ?? layers.filter((layer) => layer.visible !== false).map((layer) => layer.id)),
	)

	// ResizeObserver-driven container dimensions — tracks the actual canvas parent,
	// not the window. Survives split-panel drags and IDE layout changes.
	const [dimensions, setDimensions] = useState<{ width: number; height: number }>({ width: 800, height: 600 })
	useEffect(() => {
		const node = containerRef.current
		if (!node) {
			return
		}
		const update = () => {
			const rect = node.getBoundingClientRect()
			setDimensions({ width: Math.max(100, rect.width), height: Math.max(100, rect.height) })
		}
		update()
		const observer = new ResizeObserver(update)
		observer.observe(node)
		return () => observer.disconnect()
	}, [])

	// Cursor coordinates for the status bar (lon/lat under mouse)
	const [cursorCoord, setCursorCoord] = useState<{ lon: number; lat: number } | null>(null)

	// Drag-and-drop state — drop zone visibility + last-drop status
	const [isDragOver, setIsDragOver] = useState(false)
	const [dropStatus, setDropStatus] = useState<{ kind: "ok" | "err"; msg: string } | null>(null)
	const dragDepthRef = useRef(0) // dragenter/leave fire for child elements; track depth

	const onDragEnter = useCallback((e: React.DragEvent) => {
		// Only react if files are being dragged (not text/HTML from inside the editor)
		if (!e.dataTransfer?.types?.includes("Files")) {
			return
		}
		e.preventDefault()
		dragDepthRef.current += 1
		setIsDragOver(true)
	}, [])
	const onDragLeave = useCallback((e: React.DragEvent) => {
		if (!e.dataTransfer?.types?.includes("Files")) {
			return
		}
		e.preventDefault()
		dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
		if (dragDepthRef.current === 0) {
			setIsDragOver(false)
		}
	}, [])
	const onDragOver = useCallback((e: React.DragEvent) => {
		if (!e.dataTransfer?.types?.includes("Files")) {
			return
		}
		e.preventDefault()
		e.dataTransfer.dropEffect = "copy"
	}, [])
	const onDrop = useCallback(async (e: React.DragEvent) => {
		if (!e.dataTransfer?.files || e.dataTransfer.files.length === 0) {
			return
		}
		e.preventDefault()
		dragDepthRef.current = 0
		setIsDragOver(false)
		const result = await loadAndPushFiles(e.dataTransfer.files)
		if (result.loaded > 0 && result.errors.length === 0) {
			setDropStatus({ kind: "ok", msg: `Loaded ${result.loaded} layer${result.loaded > 1 ? "s" : ""}.` })
		} else if (result.loaded > 0) {
			setDropStatus({
				kind: "ok",
				msg: `Loaded ${result.loaded}, ${result.errors.length} error${result.errors.length > 1 ? "s" : ""}.`,
			})
		} else {
			setDropStatus({ kind: "err", msg: result.errors[0] ?? "Unsupported file." })
		}
		window.setTimeout(() => setDropStatus(null), 4000)
	}, [])

	// Persist UI state whenever it changes
	useEffect(() => {
		saveMapWorkspace({
			basemap: selectedBaseMap,
			viewState,
			visibleLayerIds: Array.from(visibleLayerIds),
		})
	}, [selectedBaseMap, viewState, visibleLayerIds])

	// Listen for files sent from the VS Code extension side (e.g. right-click "Add to Map").
	// The extension reads the file bytes and posts { type:'aihydro-load-file', name, data: number[] }.
	useEffect(() => {
		const handler = async (event: MessageEvent) => {
			const msg = event.data
			if (msg?.type !== "aihydro-load-file" || !msg.name || !Array.isArray(msg.data)) {
				return
			}
			const bytes = new Uint8Array(msg.data)
			const file = new File([bytes], msg.name)
			const result = await loadAndPushFiles([file])
			if (result.loaded > 0 && result.errors.length === 0) {
				setDropStatus({ kind: "ok", msg: `Loaded ${msg.name}.` })
			} else {
				setDropStatus({ kind: "err", msg: result.errors[0] ?? `Failed to load ${msg.name}.` })
			}
			window.setTimeout(() => setDropStatus(null), 4000)
		}
		window.addEventListener("message", handler)
		return () => window.removeEventListener("message", handler)
	}, [])

	// Build deck.gl TileLayer for the base map.
	// Uses fetch + createImageBitmap so no loaders.gl or Mapbox token is needed.
	const basemapLayer = useMemo(() => {
		const baseMapConfig = BASE_MAP_STYLES.find((s) => s.id === selectedBaseMap)
		// Skip Mapbox-scheme URLs (require token) — fall back to first non-Mapbox style
		const tileUrl =
			baseMapConfig && !baseMapConfig.url.startsWith("mapbox://")
				? baseMapConfig.url
				: (BASE_MAP_STYLES.find((s) => !s.url.startsWith("mapbox://"))?.url ?? BASE_MAP_STYLES[0].url)

		return new TileLayer({
			id: "basemap",
			data: tileUrl,
			minZoom: 0,
			maxZoom: 19,
			tileSize: 256,
			getTileData: async (tile: any) => {
				if (!tile.url) {
					return null
				}
				try {
					const resp = await fetch(tile.url)
					if (!resp.ok) {
						return null
					}
					const blob = await resp.blob()
					return createImageBitmap(blob)
				} catch {
					return null
				}
			},
			renderSubLayers: (props: any) => {
				const {
					bbox: { west, south, east, north },
				} = props.tile
				if (!props.data) {
					return null
				}
				return new BitmapLayer(props, {
					data: undefined,
					image: props.data,
					bounds: [west, south, east, north] as [number, number, number, number],
					pickable: false,
				})
			},
		})
	}, [selectedBaseMap])

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

	// Preload raster images that arrived via gRPC (Python-pushed via
	// MapEventWatcher) into the rasterCache. User-loaded rasters are populated
	// directly by pushLayer.ts, so they skip this path.
	useEffect(() => {
		let cancelled = false
		for (const layer of layers) {
			if (layer.layerType !== "raster") continue
			if (rasterCache.has(layer.id)) continue
			const dataUrl = layer.metadata?.raster_data_url
			const boundsRaw = layer.metadata?.raster_bounds
			if (!dataUrl || !boundsRaw) {
				console.error(
					`[MapView] Raster layer "${layer.name}" (${layer.id}) is missing image data or bounds in metadata. PNG path read may have failed in MapEventWatcher.`,
				)
				continue
			}
			let bounds: [number, number, number, number]
			try {
				bounds = JSON.parse(boundsRaw)
			} catch (err) {
				console.error(`[MapView] Bad raster_bounds for layer ${layer.id}:`, err)
				continue
			}
			dataUrlToImage(dataUrl)
				.then((image) => {
					if (cancelled) return
					rasterCache.set(layer.id, { image, bounds })
					setRasterReadyTick((t) => t + 1)
				})
				.catch((err) => {
					console.error(`[MapView] Failed to decode raster image for layer ${layer.id}:`, err)
				})
		}
		return () => {
			cancelled = true
		}
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
				.map((layer) =>
					layer.layerType === "raster"
						? getRasterBoundsFromLayer(layer, rasterCache)
						: getBoundsFromGeojsonString(layer.geojson),
				)
				.filter((value): value is BoundingBox => value !== undefined),
		)
		if (!bounds) {
			return
		}
		lastAutoFitKeyRef.current = autoFitKey
		setViewState((previousViewState) => fitViewStateToBounds(bounds, dimensions, previousViewState))
	}, [layers, visibleLayerIds, dimensions])

	const handleZoomToLayer = (layer: MapLayer) => {
		const bounds =
			layer.layerType === "raster"
				? getRasterBoundsFromLayer(layer, rasterCache)
				: getBoundsFromGeojsonString(layer.geojson)
		if (!bounds) {
			return
		}
		setViewState((previousViewState) => fitViewStateToBounds(bounds, dimensions, previousViewState))
	}

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

	// Sort layers by custom order for deck.gl (last = on top)
	const sortedLayers = useMemo(() => {
		if (layerOrder.length === 0) return layers
		const byId = new Map(layers.map((l) => [l.id, l]))
		const sorted = layerOrder.map((id) => byId.get(id)).filter(Boolean) as typeof layers
		const inOrder = new Set(layerOrder)
		for (const l of layers) if (!inOrder.has(l.id)) sorted.push(l)
		return sorted
	}, [layers, layerOrder])

	const dataLayers = useMemo(
		() =>
			sortedLayers
				.filter((layer) => visibleLayerIds.has(layer.id))
				.map((layer) => {
					try {
						if (layer.layerType === "raster") {
							// Always render via the rasterCache (HTMLImageElement). Strings
							// (data URLs / file paths) are unsafe to hand to BitmapLayer in
							// the VS Code webview — its CSP forbids `data:` in connect-src,
							// so deck.gl's loader-based fetch fails silently.
							const cached = rasterCache.get(layer.id)
							if (!cached) {
								// Python-pushed rasters arrive with `raster_data_url` in
								// metadata; the preload effect below converts that into an
								// HTMLImageElement and re-renders. First render returns null.
								return null
							}

							// Detect colormap change and trigger async re-render.
							// rawPixels is only available for user-loaded GeoTIFFs.
							const targetColormap = layer.metadata?.raster_colormap ?? "viridis"
							if (cached.colormap !== targetColormap && cached.rawPixels && !rasterRecolorInFlight.has(layer.id)) {
								rasterRecolorInFlight.add(layer.id)
								applyColormap(cached.rawPixels, targetColormap)
									.then((image) => {
										rasterCache.set(layer.id, { ...cached, image, colormap: targetColormap })
										rasterRecolorInFlight.delete(layer.id)
										setRasterReadyTick((t) => t + 1)
									})
									.catch((err) => {
										rasterRecolorInFlight.delete(layer.id)
										console.error(`[MapView] Colormap re-render failed for ${layer.id}:`, err)
									})
							}

							const opacity = parseFloat(layer.metadata?.raster_opacity ?? "0.75")
							return new BitmapLayer({
								id: layer.id,
								image: cached.image,
								bounds: cached.bounds,
								opacity,
								pickable: false,
							})
						}
						const geojson = JSON.parse(layer.geojson)
						const style = layer.style
						const fillColor = style?.fillColor ? hexToRgb(style.fillColor) : [0, 102, 204]
						// Stroke color: prefer the explicit strokeColor, then color (legacy), then derive
						const strokeRaw = style?.strokeColor ?? style?.color ?? "#003399"
						const strokeColor = hexToRgb(strokeRaw)
						const fillOpacity = style?.fillOpacity !== undefined ? style.fillOpacity * 255 : 153
						const strokeWidth = style?.strokeWidth ?? style?.weight ?? 2
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
		// sortedLayers already depends on layers+layerOrder; rasterReadyTick bumps
		// when async raster preloads finish so the BitmapLayer instantiates after
		// the image is ready.
		[sortedLayers, visibleLayerIds, rasterReadyTick],
	)

	const allLayers = [basemapLayer, ...dataLayers]

	const bgColor = mapStyle === "dark" ? "#1a1a2e" : "#f0f0f0"

	return (
		<div
			className="map-view-container"
			onDragEnter={onDragEnter}
			onDragLeave={onDragLeave}
			onDragOver={onDragOver}
			onDrop={onDrop}
			ref={containerRef}
			style={{
				width: "100%",
				height: "100%",
				position: "relative",
				background: bgColor,
				overflow: "hidden",
			}}>
			<DeckGL
				controller={true}
				getTooltip={layers.length > 0 ? getTooltip : undefined}
				layers={allLayers}
				onHover={({ coordinate }: any) => {
					if (coordinate && Array.isArray(coordinate) && coordinate.length >= 2) {
						setCursorCoord({ lon: coordinate[0], lat: coordinate[1] })
					} else {
						setCursorCoord(null)
					}
				}}
				onViewStateChange={({ viewState: nextViewState }: { viewState: MapViewState }) => setViewState(nextViewState)}
				style={{ position: "absolute", inset: 0 }}
				viewState={viewState}
			/>

			{layers.length === 0 && (
				<div
					style={{
						position: "absolute",
						inset: 0,
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						flexDirection: "column",
						gap: "12px",
						color: mapStyle === "dark" ? "rgba(255,255,255,0.85)" : "rgba(0,0,0,0.8)",
						pointerEvents: "none",
					}}>
					<div style={{ fontSize: "44px" }}>🗺️</div>
					<h2 style={{ margin: 0, fontSize: 18, textShadow: "0 1px 3px rgba(0,0,0,0.5)" }}>AI-Hydro Map</h2>
					<p style={{ margin: 0, fontSize: 13, opacity: 0.85, textShadow: "0 1px 2px rgba(0,0,0,0.4)" }}>
						No layers yet — run a hydrological analysis or push a layer to get started.
					</p>
				</div>
			)}

			<MapToolRibbon
				currentBasemap={selectedBaseMap}
				layerCount={layers.length}
				layerOrder={layerOrder}
				mapStyle={mapStyle === "dark" ? "dark" : "light"}
				onBasemapChange={setSelectedBaseMap}
				onReorder={setLayerOrder}
				onVisibilityChange={handleVisibilityChange}
				onZoomToLayer={handleZoomToLayer}
				visibleLayerIds={visibleLayerIds}
			/>

			<RasterLegend layers={sortedLayers} mapStyle={mapStyle} visibleLayerIds={visibleLayerIds} />

			<MapStatusBar cursorCoord={cursorCoord} mapStyle={mapStyle} viewState={viewState} />

			{/* Drop-zone overlay — shown while files are being dragged over the map */}
			{isDragOver && (
				<div
					style={{
						position: "absolute",
						inset: 8,
						zIndex: 6,
						border: "2px dashed var(--vscode-focusBorder, #0e639c)",
						borderRadius: 8,
						background: mapStyle === "dark" ? "rgba(14, 99, 156, 0.18)" : "rgba(14, 99, 156, 0.10)",
						display: "flex",
						flexDirection: "column",
						alignItems: "center",
						justifyContent: "center",
						gap: 12,
						color: mapStyle === "dark" ? "#fff" : "#000",
						pointerEvents: "none",
						backdropFilter: "blur(2px)",
					}}>
					<div style={{ fontSize: 48 }}>📥</div>
					<div style={{ fontSize: 16, fontWeight: 600 }}>Drop to add layer</div>
					<div style={{ fontSize: 12, opacity: 0.85 }}>
						GeoJSON · KML · KMZ · GPX · Shapefile (.zip) · GeoTIFF · CSV
					</div>
					<div style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>Drag from VS Code Explorer, or use + Add Layer</div>
				</div>
			)}

			{/* Toast — transient feedback after drop or picker action */}
			{dropStatus && (
				<div
					style={{
						position: "absolute",
						bottom: 36,
						left: "50%",
						transform: "translateX(-50%)",
						zIndex: 7,
						padding: "6px 12px",
						background:
							dropStatus.kind === "ok"
								? "var(--vscode-notificationsInfoIcon-foreground, #0e639c)"
								: "var(--vscode-errorForeground, #dc3545)",
						color: "#fff",
						borderRadius: 4,
						fontSize: 12,
						boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
					}}>
					{dropStatus.msg}
				</div>
			)}
		</div>
	)
}

// ─── Raster Legend (colorbar overlay) ────────────────────────────────────────

const LEGEND_GRADIENTS: Record<string, string> = {
	viridis: "linear-gradient(to right, #440154, #31688e, #35b779, #fde725)",
	viridis_r: "linear-gradient(to right, #fde725, #35b779, #31688e, #440154)",
	YlOrRd: "linear-gradient(to right, #ffffb2, #fecc5c, #fd8d3c, #e31a1c)",
	Blues: "linear-gradient(to right, #f7fbff, #6baed6, #2171b5, #084594)",
	RdYlGn: "linear-gradient(to right, #d73027, #fee08b, #1a9850)",
	plasma: "linear-gradient(to right, #0d0887, #7d03a8, #cb4679, #f89441, #f0f921)",
	magma: "linear-gradient(to right, #000004, #3e0966, #b22b6b, #fb8861, #fcfdbf)",
	cividis: "linear-gradient(to right, #00204e, #4b5890, #95909b, #dbc07b, #fde737)",
}

interface RasterLegendProps {
	layers: MapLayer[]
	visibleLayerIds: Set<string>
	mapStyle: string
}

const RasterLegend: React.FC<RasterLegendProps> = ({ layers, visibleLayerIds, mapStyle }) => {
	const visibleRasters = layers.filter((l) => l.layerType === "raster" && visibleLayerIds.has(l.id))
	if (visibleRasters.length === 0) return null

	// Show legend for the topmost visible raster (last in render order)
	const layer = visibleRasters[visibleRasters.length - 1]
	const colormap = layer.metadata?.raster_colormap ?? "viridis"
	const minVal = layer.metadata?.min ? parseFloat(layer.metadata.min).toPrecision(4) : "—"
	const maxVal = layer.metadata?.max ? parseFloat(layer.metadata.max).toPrecision(4) : "—"
	const gradient = LEGEND_GRADIENTS[colormap] ?? LEGEND_GRADIENTS["viridis"]

	const isDark = mapStyle === "dark"
	const bg = isDark ? "rgba(18,18,26,0.88)" : "rgba(252,252,252,0.90)"
	const fg = isDark ? "rgba(255,255,255,0.85)" : "rgba(0,0,0,0.85)"
	const bdClr = isDark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.14)"

	return (
		<div
			style={{
				position: "absolute",
				bottom: 42, // above the status bar
				left: 12,
				zIndex: 4,
				padding: "6px 10px 5px",
				background: bg,
				border: `1px solid ${bdClr}`,
				borderRadius: 5,
				boxShadow: "0 1px 5px rgba(0,0,0,0.28)",
				fontFamily: "var(--vscode-font-family, system-ui, sans-serif)",
				fontSize: 10,
				color: fg,
				minWidth: 150,
				maxWidth: 200,
				pointerEvents: "none",
			}}>
			{/* Layer name */}
			<div
				style={{
					marginBottom: 4,
					fontSize: 10,
					opacity: 0.72,
					overflow: "hidden",
					textOverflow: "ellipsis",
					whiteSpace: "nowrap",
				}}>
				{layer.name}
			</div>
			{/* Gradient bar */}
			<div style={{ height: 10, background: gradient, borderRadius: 2, border: `1px solid ${bdClr}`, marginBottom: 3 }} />
			{/* Min / max labels */}
			<div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, opacity: 0.78 }}>
				<span>{minVal}</span>
				<span>{maxVal}</span>
			</div>
		</div>
	)
}

export default MapView
