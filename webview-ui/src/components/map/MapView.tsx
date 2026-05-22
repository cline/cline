import type { MapViewState } from "@deck.gl/core"
import { TileLayer } from "@deck.gl/geo-layers"
import { BitmapLayer, GeoJsonLayer, TextLayer } from "@deck.gl/layers"
import DeckGL from "@deck.gl/react"
import type { MapLayer } from "@shared/proto/cline/map"
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useMapContext } from "../../context/MapContext"
import { BASE_MAP_STYLES } from "./BaseMapSelector"
import FeatureIdentifier, { type ClickedFeature, type MapInspectPoint } from "./FeatureIdentifier"
import { loadAndPushFiles } from "./formats"
import { applyColormap, dataUrlToImage, rasterCache, rasterRecolorInFlight } from "./formats/rasterCache"
import { collectFeaturesAtPoint } from "./geoInspect"
import { fmtDist, haversineKm } from "./geoMeasureMath"
import MapLegend from "./MapLegend"
import { MapToolRibbon } from "./MapToolRibbon"
import MeasureTool, { type MeasureMode } from "./MeasureTool"
import { askAgentAboutMap, askAgentToDelineate, type MapAgentInspectContext } from "./mapAgentBridge"
import { hasMeritRiversOnMap, isConus, meritRiversRequiredMessage } from "./mapHydroGuards"
import { sendHydroMapCommand } from "./mapHydrologyBridge"
import { type CursorRasterReading, getLayerBounds, isGeoJsonLayer, sampleTopRasterAtPoint } from "./mapLayerAdapters"
import { reportBasemapChanged, reportMapEvent, reportVisibleLayers } from "./mapSessionBridge"
import { loadMapWorkspace, saveMapWorkspace } from "./mapWorkspace"
import SearchBar from "./SearchBar"
import VectorDrawTool, { type CompletedVectorDraw, type VectorDrawMode } from "./VectorDrawTool"
import VectorSavePanel from "./VectorSavePanel"

type BoundingBox = [number, number, number, number]

function buildMapAgentContext(
	pt: MapInspectPoint,
	features: ClickedFeature[],
	layers: MapLayer[],
	visibleLayerIds: Set<string>,
): MapAgentInspectContext {
	const primary = features[0]
	return {
		lat: pt.lat,
		lon: pt.lon,
		layerName: primary?.layerName,
		featureProperties: primary?.properties,
		visibleLayerNames: layers.filter((l) => visibleLayerIds.has(l.id)).map((l) => l.name),
	}
}

/**
 * Sample a raster's underlying pixel value at a WGS84 lon/lat. Returns null if
 * the layer has no rawPixels (e.g. Python-pushed PNG without numeric backing),
 * the cursor is outside the bounds, or the sampled pixel is nodata.
 */
const sampleRasterAtCursor = (layer: MapLayer, lon: number, lat: number): CursorRasterReading | null => {
	const cached = rasterCache.get(layer.id)
	if (!cached?.rawPixels) {
		return null
	}
	const { data, width, height, min, max } = cached.rawPixels
	const [minLon, minLat, maxLon, maxLat] = cached.bounds
	if (lon < minLon || lon > maxLon || lat < minLat || lat > maxLat) {
		return null
	}
	const px = Math.floor(((lon - minLon) / (maxLon - minLon)) * width)
	const py = Math.floor(((maxLat - lat) / (maxLat - minLat)) * height)
	if (px < 0 || px >= width || py < 0 || py >= height) {
		return null
	}
	const value = data[py * width + px]
	if (!Number.isFinite(value)) {
		return null
	}
	return {
		layerId: layer.id,
		layerName: layer.name,
		value,
		min,
		max,
		colormap: layer.metadata?.raster_colormap ?? "viridis",
		units: layer.metadata?.units,
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

/**
 * Ray-casting point-in-polygon test. Returns true if a point is inside or on the
 * boundary of a polygon. Handles holes and multi-ring polygons.
 */
const pointInPolygon = (point: [number, number], polygon: number[][][]): boolean => {
	const [lon, lat] = point
	for (let i = 0; i < polygon.length; i++) {
		const ring = polygon[i]
		let inside = false
		for (let j = 0, k = ring.length - 1; j < ring.length; k = j++) {
			const [x1, y1] = ring[k]
			const [x2, y2] = ring[j]
			const intersect = y1 > lat !== y2 > lat && lon < ((x2 - x1) * (lat - y1)) / (y2 - y1) + x1
			if (intersect) {
				inside = !inside
			}
		}
		if (i === 0 && !inside) {
			return false // outside outer ring
		}
		if (i > 0 && inside) {
			return false // inside a hole
		}
	}
	return true
}

/**
 * Test if a GeoJSON feature geometry contains a point.
 */
/**
 * Grid-based point clustering for dense gauge / station networks.
 * At low zoom levels, nearby points are aggregated into a single Point
 * feature whose radius reflects the count. Returns standard GeoJSON so
 * deck.gl GeoJsonLayer can render it directly.
 */
const clusterGeoJSON = (geojson: any, zoom: number): any => {
	if (zoom >= 8) {
		return geojson
	}
	const gridSize = Math.max(0.08, Math.min(1.5, 2 ** (4 - zoom)))

	const points: Array<{ lon: number; lat: number; props: any }> = []
	const extract = (obj: any) => {
		if (!obj) {
			return
		}
		if (obj.type === "Point" && Array.isArray(obj.coordinates)) {
			points.push({ lon: obj.coordinates[0], lat: obj.coordinates[1], props: obj.properties })
		} else if (obj.type === "MultiPoint" && Array.isArray(obj.coordinates)) {
			obj.coordinates.forEach((c: number[]) => points.push({ lon: c[0], lat: c[1], props: obj.properties }))
		} else if (obj.type === "FeatureCollection" && Array.isArray(obj.features)) {
			obj.features.forEach((f: any) => extract(f.geometry))
		} else if (obj.type === "Feature") {
			extract(obj.geometry)
		}
	}
	extract(geojson)
	if (points.length === 0) {
		return geojson
	}

	const clusters = new Map<string, { lon: number; lat: number; count: number; sampleProps: any }>()
	for (const pt of points) {
		const gx = Math.floor(pt.lon / gridSize)
		const gy = Math.floor(pt.lat / gridSize)
		const key = `${gx},${gy}`
		const existing = clusters.get(key)
		if (existing) {
			existing.lon += pt.lon
			existing.lat += pt.lat
			existing.count += 1
		} else {
			clusters.set(key, { lon: pt.lon, lat: pt.lat, count: 1, sampleProps: pt.props })
		}
	}

	const features = Array.from(clusters.values()).map((c) => ({
		type: "Feature" as const,
		geometry: { type: "Point" as const, coordinates: [c.lon / c.count, c.lat / c.count] as [number, number] },
		properties: { _clusterCount: c.count, _clustered: true, ...c.sampleProps },
	}))

	return { type: "FeatureCollection" as const, features }
}

const featureContainsPoint = (feature: any, lon: number, lat: number): boolean => {
	const point: [number, number] = [lon, lat]
	const geometry = feature?.geometry

	if (!geometry) {
		return false
	}

	const type = geometry.type
	const coords = geometry.coordinates

	if (type === "Point") {
		// Exact point match (with small tolerance for floating point)
		return Math.abs(coords[0] - lon) < 0.0001 && Math.abs(coords[1] - lat) < 0.0001
	}

	if (type === "LineString") {
		// Proximity to line (within ~111 meters at equator = 0.001 degrees)
		const tolerance = 0.001
		for (let i = 0; i < coords.length - 1; i++) {
			const [x1, y1] = coords[i]
			const [x2, y2] = coords[i + 1]
			const dx = x2 - x1
			const dy = y2 - y1
			const len2 = dx * dx + dy * dy
			let t = ((lon - x1) * dx + (lat - y1) * dy) / len2
			t = Math.max(0, Math.min(1, t))
			const closestLon = x1 + t * dx
			const closestLat = y1 + t * dy
			const dist2 = (lon - closestLon) ** 2 + (lat - closestLat) ** 2
			if (dist2 < tolerance * tolerance) {
				return true
			}
		}
		return false
	}

	if (type === "Polygon") {
		return pointInPolygon(point, coords)
	}

	if (type === "MultiPoint") {
		return coords.some((c: number[]) => Math.abs(c[0] - lon) < 0.0001 && Math.abs(c[1] - lat) < 0.0001)
	}

	if (type === "MultiLineString") {
		const tolerance = 0.001
		return coords.some((line: number[][]) => {
			for (let i = 0; i < line.length - 1; i++) {
				const [x1, y1] = line[i]
				const [x2, y2] = line[i + 1]
				const dx = x2 - x1
				const dy = y2 - y1
				const len2 = dx * dx + dy * dy
				let t = ((lon - x1) * dx + (lat - y1) * dy) / len2
				t = Math.max(0, Math.min(1, t))
				const closestLon = x1 + t * dx
				const closestLat = y1 + t * dy
				const dist2 = (lon - closestLon) ** 2 + (lat - closestLat) ** 2
				if (dist2 < tolerance * tolerance) {
					return true
				}
			}
			return false
		})
	}

	if (type === "MultiPolygon") {
		return coords.some((poly: number[][][]) => pointInPolygon(point, poly))
	}

	return false
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

// ─── Global ESC handler hook ─────────────────────────────────────────────────
// Defined *before* MapView so the component can call it without a ReferenceError.

const useEscToClosePanels = ({
	measureMode,
	setMeasureMode,
	setMeasureGeometry,
	drawMode,
	setDrawMode,
	setDrawGeometry,
	pendingDraw,
	setPendingDraw,
	searchOpen,
	setSearchOpen,
	exportOpen,
	setExportOpen,
}: {
	measureMode: MeasureMode
	setMeasureMode: (m: MeasureMode) => void
	setMeasureGeometry: (g: any) => void
	drawMode: VectorDrawMode
	setDrawMode: (m: VectorDrawMode) => void
	setDrawGeometry: (g: any) => void
	pendingDraw: CompletedVectorDraw | null
	setPendingDraw: (d: CompletedVectorDraw | null) => void
	searchOpen: boolean
	setSearchOpen: (v: boolean) => void
	exportOpen: boolean
	setExportOpen: (v: boolean) => void
}) => {
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.key !== "Escape") {
				return
			}
			// Only close if not typing in an input/textarea
			const target = e.target as HTMLElement
			if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
				return
			}

			let consumed = false
			if (pendingDraw) {
				setPendingDraw(null)
				setDrawGeometry(null)
				consumed = true
			}
			if (drawMode) {
				setDrawMode(null)
				setDrawGeometry(null)
				consumed = true
			}
			if (measureMode) {
				setMeasureMode(null)
				setMeasureGeometry(null)
				consumed = true
			}
			if (searchOpen) {
				setSearchOpen(false)
				consumed = true
			}
			if (exportOpen) {
				setExportOpen(false)
				consumed = true
			}
			if (consumed) {
				e.preventDefault()
				e.stopPropagation()
			}
		}
		window.addEventListener("keydown", handler, true)
		return () => window.removeEventListener("keydown", handler, true)
	}, [
		measureMode,
		drawMode,
		pendingDraw,
		searchOpen,
		exportOpen,
		setMeasureMode,
		setMeasureGeometry,
		setDrawMode,
		setDrawGeometry,
		setPendingDraw,
		setSearchOpen,
		setExportOpen,
	])
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
	// Per-layer opacity overrides (layerId -> 0..1)
	const [layerOpacities, setLayerOpacities] = useState<Record<string, number>>(persisted.layerOpacities ?? {})
	// Search / measure / export UI state
	const [measureMode, setMeasureMode] = useState<MeasureMode>(null)
	const [drawMode, setDrawMode] = useState<VectorDrawMode>(null)
	const [searchOpen, setSearchOpen] = useState(false)
	const [exportOpen, setExportOpen] = useState(false)
	const [saveVectorBusy, setSaveVectorBusy] = useState(false)
	// Point clustering — layers that should cluster dense point data at low zoom
	const [clusterLayerIds, setClusterLayerIds] = useState<Set<string>>(new Set(persisted.clusterLayerIds ?? []))
	const [measureGeometry, setMeasureGeometry] = useState<any>(null)
	const [drawGeometry, setDrawGeometry] = useState<any>(null)
	const [pendingDraw, setPendingDraw] = useState<CompletedVectorDraw | null>(null)
	const [toolHoverCoord, setToolHoverCoord] = useState<{ lon: number; lat: number } | null>(null)
	// Search result pin — { lon, lat, label } or null
	const [searchPin, setSearchPin] = useState<{ lon: number; lat: number; label: string } | null>(null)
	const [searchStatus, setSearchStatus] = useState("")

	const mapViewBbox = useCallback(() => {
		const z = viewState.zoom ?? 8
		const deg = 360 / 2 ** (z + 1)
		return {
			minLon: viewState.longitude - deg,
			minLat: viewState.latitude - deg * 0.6,
			maxLon: viewState.longitude + deg,
			maxLat: viewState.latitude + deg * 0.6,
		}
	}, [viewState.longitude, viewState.latitude, viewState.zoom])

	const measureClickRef = useRef<((coord: [number, number]) => void) | null>(null)
	const drawClickRef = useRef<((coord: [number, number]) => void) | null>(null)

	useEscToClosePanels({
		measureMode,
		setMeasureMode,
		setMeasureGeometry,
		drawMode,
		setDrawMode,
		setDrawGeometry,
		pendingDraw,
		setPendingDraw,
		searchOpen,
		setSearchOpen,
		exportOpen,
		setExportOpen,
	})

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

	// Feature identifier — stores clicked vector features at a point
	const [clickedFeatures, setClickedFeatures] = useState<ClickedFeature[]>([])
	const [inspectPoint, setInspectPoint] = useState<{ lon: number; lat: number } | null>(null)
	const [delineating, setDelineating] = useState(false)
	const [delineateStatus, setDelineateStatus] = useState<string | null>(null)
	const [agentStarting, setAgentStarting] = useState(false)
	const [agentStatus, setAgentStatus] = useState<string | null>(null)
	const [inspectRasterReading, setInspectRasterReading] = useState<CursorRasterReading | null>(null)

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
			layerOpacities,
			clusterLayerIds: Array.from(clusterLayerIds),
		})
	}, [selectedBaseMap, viewState, visibleLayerIds, layerOpacities, clusterLayerIds])

	// Sync basemap to host so the agent knows which tile layer is active
	useEffect(() => {
		const style = BASE_MAP_STYLES.find((s) => s.id === selectedBaseMap)
		reportBasemapChanged(selectedBaseMap, style?.name ?? selectedBaseMap)
	}, [selectedBaseMap])

	// Sync visible layer set (debounced)
	const visibleSyncRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	useEffect(() => {
		if (visibleSyncRef.current) {
			clearTimeout(visibleSyncRef.current)
		}
		visibleSyncRef.current = setTimeout(() => {
			reportVisibleLayers(Array.from(visibleLayerIds))
		}, 300)
		return () => {
			if (visibleSyncRef.current) {
				clearTimeout(visibleSyncRef.current)
			}
		}
	}, [visibleLayerIds])

	// Debounced view telemetry
	const viewReportRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	useEffect(() => {
		if (viewReportRef.current) {
			clearTimeout(viewReportRef.current)
		}
		viewReportRef.current = setTimeout(() => {
			reportMapEvent("view.changed", {
				longitude: viewState.longitude,
				latitude: viewState.latitude,
				zoom: viewState.zoom,
			})
		}, 500)
		return () => {
			if (viewReportRef.current) {
				clearTimeout(viewReportRef.current)
			}
		}
	}, [viewState.longitude, viewState.latitude, viewState.zoom])

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
			if (layer.layerType !== "raster") {
				continue
			}
			if (rasterCache.has(layer.id)) {
				continue
			}
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
					if (cancelled) {
						return
					}
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

	const handleOpacityChange = (layerId: string, opacity: number) => {
		setLayerOpacities((prev) => ({ ...prev, [layerId]: Math.max(0, Math.min(1, opacity)) }))
	}

	const handleClusterToggle = (layerId: string, enabled: boolean) => {
		setClusterLayerIds((prev) => {
			const next = new Set(prev)
			if (enabled) {
				next.add(layerId)
			} else {
				next.delete(layerId)
			}
			return next
		})
	}

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
		reportMapEvent("layer.visibility", { layerId, visible })
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
				.map((layer) => getLayerBounds(layer, rasterCache))
				.filter((value): value is BoundingBox => value !== undefined),
		)
		if (!bounds) {
			return
		}
		lastAutoFitKeyRef.current = autoFitKey
		setViewState((previousViewState) => fitViewStateToBounds(bounds, dimensions, previousViewState))
	}, [layers, visibleLayerIds, dimensions])

	const handleZoomToLayer = (layer: MapLayer) => {
		const bounds = getLayerBounds(layer, rasterCache)
		if (!bounds) {
			return
		}
		setViewState((previousViewState) => fitViewStateToBounds(bounds, dimensions, previousViewState))
	}

	/** geemap Map.centerObject — fit all visible layers (or all if none visible). */
	const handleFitExtent = useCallback(() => {
		const targetLayers = layers.filter((layer) => (visibleLayerIds.size > 0 ? visibleLayerIds.has(layer.id) : true))
		const bounds = mergeBounds(
			targetLayers
				.map((layer) => getLayerBounds(layer, rasterCache))
				.filter((value): value is BoundingBox => value !== undefined),
		)
		if (!bounds) {
			return
		}
		setViewState((previousViewState) => fitViewStateToBounds(bounds, dimensions, previousViewState))
	}, [layers, visibleLayerIds, dimensions])

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

	// Live raster pixel value at cursor — drives the legend's "current value" tick.
	// Always reads the topmost visible raster (last in sortedLayers); returns null
	// if cursor is outside any raster, or the layer has no rawPixels (Python-pushed).
	const cursorRasterReading = useMemo<CursorRasterReading | null>(() => {
		if (!cursorCoord) {
			return null
		}
		const visibleRasters = layers.filter((l) => l.layerType === "raster" && visibleLayerIds.has(l.id))
		if (visibleRasters.length === 0) {
			return null
		}
		// Apply current sort order so the "topmost" matches what the user sees rendered
		const ordered =
			layerOrder.length > 0
				? (layerOrder.map((id) => visibleRasters.find((l) => l.id === id)).filter(Boolean) as MapLayer[])
				: visibleRasters
		const ordered2 = ordered.length > 0 ? ordered : visibleRasters
		// Search top-to-bottom; pick the first raster whose bounds contain the cursor
		for (let i = ordered2.length - 1; i >= 0; i--) {
			const reading = sampleRasterAtCursor(ordered2[i], cursorCoord.lon, cursorCoord.lat)
			if (reading) {
				return reading
			}
		}
		return null
		// rasterReadyTick included so the reading refreshes after async colormap/preload updates
	}, [cursorCoord, layers, visibleLayerIds, layerOrder, rasterReadyTick])

	// Sort layers by custom order for deck.gl (last = on top)
	const sortedLayers = useMemo(() => {
		if (layerOrder.length === 0) {
			return layers
		}
		const byId = new Map(layers.map((l) => [l.id, l]))
		const sorted = layerOrder.map((id) => byId.get(id)).filter(Boolean) as typeof layers
		const inOrder = new Set(layerOrder)
		for (const l of layers) {
			if (!inOrder.has(l.id)) {
				sorted.push(l)
			}
		}
		return sorted
	}, [layers, layerOrder])

	const handleMapClick = useCallback(
		(info: any) => {
			// If measure mode is active, feed the coordinate to the measure tool
			// and skip feature identification entirely.
			if ((measureMode || drawMode) && info.coordinate) {
				if (drawMode && !pendingDraw) {
					drawClickRef.current?.(info.coordinate)
				} else if (measureMode) {
					measureClickRef.current?.(info.coordinate)
				}
				return
			}

			const clickLon = info.coordinate?.[0]
			const clickLat = info.coordinate?.[1]

			if (typeof clickLon !== "number" || typeof clickLat !== "number") {
				return
			}

			const clicked: ClickedFeature[] = []

			// Prefer deck.gl pick (matches rendered geometry).
			if (info.layer?.id && info.object) {
				const pickedLayer = sortedLayers.find((l) => l.id === info.layer.id)
				if (pickedLayer && isGeoJsonLayer(pickedLayer)) {
					clicked.push({
						layerId: pickedLayer.id,
						layerName: pickedLayer.name,
						properties: (info.object.properties as Record<string, unknown>) || {},
					})
				}
			}

			// Fallback: point-in-polygon over stored GeoJSON (workspace + agent layers).
			const manualHits = collectFeaturesAtPoint(sortedLayers, visibleLayerIds, isGeoJsonLayer, clickLon, clickLat)
			for (const hit of manualHits) {
				if (!clicked.some((c) => c.layerId === hit.layerId)) {
					clicked.push(hit)
				}
			}

			setClickedFeatures(clicked)
			setInspectPoint({ lon: clickLon, lat: clickLat })
			setInspectRasterReading(
				sampleTopRasterAtPoint(sortedLayers, visibleLayerIds, layerOrder, clickLon, clickLat, rasterCache),
			)
			const primaryFeature = clicked[0]
			reportMapEvent("inspect.click", {
				lon: clickLon,
				lat: clickLat,
				featureCount: clicked.length,
				layerIds: clicked.map((f) => f.layerId),
				layerName: primaryFeature?.layerName,
				featureProperties: primaryFeature?.properties,
				visibleLayerNames: sortedLayers.filter((l) => visibleLayerIds.has(l.id)).map((l) => l.name),
			})
		},
		[sortedLayers, visibleLayerIds, measureMode, drawMode, pendingDraw, layerOrder],
	) // Per-layer clustered GeoJSON cache — keyed by `layerId|floor(zoom)` so we
	// only re-cluster when crossing an integer zoom level, not on every frame.
	const clusterCacheRef = useRef<Map<string, any>>(new Map())

	const dataLayers = useMemo(
		() =>
			sortedLayers
				.filter((layer) => visibleLayerIds.has(layer.id))
				.map((layer) => {
					try {
						if (layer.layerType === "gee_tile") {
							const tileUrl = layer.metadata?.gee_tile_url_template || layer.metadata?.tile_url
							if (!tileUrl) {
								return null
							}
							const rawBounds = layer.metadata?.gee_bounds || layer.metadata?.raster_bounds
							let bounds: [number, number, number, number] = [-180, -60, 180, 84]
							if (rawBounds) {
								try {
									const parsed = JSON.parse(rawBounds)
									if (Array.isArray(parsed) && parsed.length === 4) {
										bounds = [parsed[0], parsed[1], parsed[2], parsed[3]]
									}
								} catch {
									/* ignore */
								}
							}
							const opacity = layerOpacities[layer.id] ?? parseFloat(layer.metadata?.raster_opacity ?? "0.75")
							return new TileLayer({
								id: layer.id,
								data: tileUrl,
								minZoom: 0,
								maxZoom: 18,
								tileSize: 256,
								getTileData: async (tile: any) => {
									if (!tile.url) return null
									try {
										const resp = await fetch(tile.url)
										if (!resp.ok) return null
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
									if (!props.data) return null
									if (east < bounds[0] || west > bounds[2] || north < bounds[1] || south > bounds[3])
										return null
									return new BitmapLayer(props, {
										data: undefined,
										image: props.data,
										bounds: [west, south, east, north] as [number, number, number, number],
										opacity,
										pickable: false,
									})
								},
							})
						}
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

							const opacity = layerOpacities[layer.id] ?? parseFloat(layer.metadata?.raster_opacity ?? "0.75")
							return new BitmapLayer({
								id: layer.id,
								image: cached.image,
								bounds: cached.bounds,
								opacity,
								pickable: false,
							})
						}
						let geojson = JSON.parse(layer.geojson)
						const style = layer.style
						// Apply point clustering for dense networks at low zoom
						if (clusterLayerIds.has(layer.id) && viewState.zoom < 8) {
							const featureCount = geojson?.features?.length ?? geojson?.coordinates?.length ?? 0
							const cacheKey = `${layer.id}|${Math.floor(viewState.zoom)}|${featureCount}`
							const cachedCluster = clusterCacheRef.current.get(cacheKey)
							if (cachedCluster) {
								geojson = cachedCluster
							} else {
								geojson = clusterGeoJSON(geojson, viewState.zoom)
								clusterCacheRef.current.set(cacheKey, geojson)
							}
						}
						const fillColor = style?.fillColor ? hexToRgb(style.fillColor) : [0, 102, 204]
						// Stroke color: prefer the explicit strokeColor, then color (legacy), then derive
						const strokeRaw = style?.strokeColor ?? style?.color ?? "#003399"
						const strokeColor = hexToRgb(strokeRaw)
						const layerOpacity = layerOpacities[layer.id] ?? 1
						const fillOpacity = Math.round(
							(style?.fillOpacity !== undefined ? style.fillOpacity : 0.6) * 255 * layerOpacity,
						)
						const strokeWidth = style?.strokeWidth ?? style?.weight ?? 2

						// Check for graduated symbology
						const graduatedAttr = layer.metadata?.graduated_attr
						const graduatedBreaks = layer.metadata?.graduated_breaks
							? JSON.parse(layer.metadata.graduated_breaks)
							: null
						const graduatedColors = layer.metadata?.graduated_colors
							? JSON.parse(layer.metadata.graduated_colors)
							: null

						const getColorFunction =
							graduatedAttr && graduatedBreaks && graduatedColors
								? (feature: any) => {
										const value = feature.properties?.[graduatedAttr]
										if (typeof value !== "number") {
											return [fillColor[0], fillColor[1], fillColor[2], fillOpacity]
										}
										// Find which class this value falls into
										for (let i = 0; i < graduatedBreaks.length; i++) {
											if (value <= graduatedBreaks[i]) {
												const colorHex = graduatedColors[i]
												const rgb = hexToRgb(colorHex)
												return [rgb[0], rgb[1], rgb[2], Math.round(230 * layerOpacity)]
											}
										}
										// Fallback: use last color if value exceeds all breaks
										const lastColorHex = graduatedColors[graduatedColors.length - 1]
										const lastRgb = hexToRgb(lastColorHex)
										return [lastRgb[0], lastRgb[1], lastRgb[2], Math.round(230 * layerOpacity)]
									}
								: [fillColor[0], fillColor[1], fillColor[2], fillOpacity]

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
							getFillColor: (feature: any): [number, number, number, number] => {
								const count = feature.properties?._clusterCount
								if (typeof count === "number" && count > 1) {
									// Use accent color for clusters
									return [14, 99, 156, Math.round(200 * layerOpacity)]
								}
								const c = typeof getColorFunction === "function" ? getColorFunction(feature) : getColorFunction
								return [c[0], c[1], c[2], c[3] ?? 255]
							},
							getLineColor: (feature: any): [number, number, number, number] => {
								const count = feature.properties?._clusterCount
								if (typeof count === "number" && count > 1) {
									return [14, 99, 156, Math.round(255 * layerOpacity)]
								}
								return [strokeColor[0], strokeColor[1], strokeColor[2], Math.round(255 * layerOpacity)]
							},
							pointRadiusUnits: "pixels" as const,
							pointRadiusMinPixels: 3,
							pointRadiusMaxPixels: 20,
							getPointRadius: (feature: any) => {
								const count = feature.properties?._clusterCount
								if (typeof count === "number" && count > 1) {
									return Math.min(20, 4 + Math.sqrt(count) * 2.5)
								}
								return 5
							},
						})
					} catch (error) {
						console.error(`Error creating layer ${layer.id}:`, error)
						return null
					}
				})
				.filter(Boolean) as any[],
		// sortedLayers already depends on layers+layerOrder; rasterReadyTick bumps
		// when async raster preloads finish so the BitmapLayer instantiates after
		// the image is ready. viewState.zoom and clusterLayerIds drive clustering.
		[sortedLayers, visibleLayerIds, rasterReadyTick, layerOpacities, viewState.zoom, clusterLayerIds],
	)

	// Measure overlay layer — renders live measurement geometry on the map
	const measureLayer = useMemo(() => {
		if (!measureGeometry) {
			return null
		}
		return new GeoJsonLayer({
			id: "__measure-overlay",
			data: measureGeometry,
			pickable: false,
			stroked: true,
			filled: true,
			extruded: false,
			lineWidthUnits: "pixels" as const,
			lineWidthMinPixels: 2,
			lineWidthMaxPixels: 6,
			getLineWidth: 3,
			getLineColor: (feature: any): [number, number, number, number] => {
				if (feature.properties?._measureArea) {
					return [14, 99, 156, 120]
				}
				return [255, 160, 0, 255]
			},
			getPointRadius: 6,
			pointRadiusUnits: "pixels" as const,
			pointRadiusMinPixels: 4,
			pointRadiusMaxPixels: 12,
			getFillColor: (feature: any): [number, number, number, number] => {
				if (feature.properties?._measureVertex) {
					return [255, 160, 0, 220]
				}
				if (feature.geometry?.type === "Point") {
					return [255, 160, 0, 220]
				}
				return [14, 99, 156, 40]
			},
		})
	}, [measureGeometry])

	// Measure segment distance labels — rendered as a TextLayer on top of the line
	const measureLabels = useMemo(() => {
		if (!measureGeometry || !measureMode) {
			return []
		}
		const labels: Array<{ position: [number, number]; text: string }> = []
		const features = measureGeometry.features || []
		// Find the line feature and compute segment distances
		const lineFeature = features.find((f: any) => f.geometry?.type === "LineString")
		if (lineFeature && measureMode === "distance") {
			const coords = lineFeature.geometry.coordinates as [number, number][]
			for (let i = 1; i < coords.length; i++) {
				const a = { lon: coords[i - 1][0], lat: coords[i - 1][1] }
				const b = { lon: coords[i][0], lat: coords[i][1] }
				const dist = haversineKm(a, b)
				const mid: [number, number] = [(a.lon + b.lon) / 2, (a.lat + b.lat) / 2]
				labels.push({ position: mid, text: fmtDist(dist) })
			}
		}
		if (labels.length === 0) {
			return []
		}
		return [
			new TextLayer({
				id: "__measure-labels",
				data: labels,
				getPosition: (d: any) => d.position,
				getText: (d: any) => d.text,
				getSize: 12,
				getColor: [255, 160, 0, 255],
				getBackgroundColor: [20, 20, 28, 200],
				background: true,
				backgroundPadding: [2, 2],
				getTextAnchor: "middle",
				getAlignmentBaseline: "center",
				billboard: true,
				pickable: false,
				fontFamily: "var(--vscode-font-family, system-ui, sans-serif)",
				fontWeight: "bold",
			}),
		]
	}, [measureGeometry, measureMode])

	const drawOverlayData = useMemo(() => {
		if (drawGeometry) {
			return drawGeometry
		}
		if (pendingDraw?.geojson) {
			try {
				return JSON.parse(pendingDraw.geojson)
			} catch {
				return null
			}
		}
		return null
	}, [drawGeometry, pendingDraw])

	const drawLayer = useMemo(() => {
		if (!drawOverlayData) {
			return null
		}
		return new GeoJsonLayer({
			id: "__draw-overlay",
			data: drawOverlayData,
			pickable: false,
			stroked: true,
			filled: true,
			extruded: false,
			lineWidthUnits: "pixels" as const,
			lineWidthMinPixels: 2,
			lineWidthMaxPixels: 6,
			getLineWidth: 3,
			getLineColor: [45, 159, 111, 255],
			getFillColor: (feature: any): [number, number, number, number] => {
				const gType = feature.geometry?.type
				if (gType === "Point" || feature.properties?._drawVertex) {
					return [45, 159, 111, 220]
				}
				if (gType === "Polygon" || feature.properties?._drawPolygon) {
					return [45, 159, 111, 80]
				}
				return [45, 159, 111, 0]
			},
			pointRadiusUnits: "pixels" as const,
			pointRadiusMinPixels: 5,
			getPointRadius: 6,
		})
	}, [drawOverlayData])

	// Search result pin layer — renders a pulsing marker pin + label
	const searchPinLayers = useMemo(() => {
		if (!searchPin) {
			return []
		}
		const pinPoint = new GeoJsonLayer({
			id: "__search-pin-point",
			data: {
				type: "FeatureCollection" as const,
				features: [
					{
						type: "Feature" as const,
						geometry: { type: "Point" as const, coordinates: [searchPin.lon, searchPin.lat] as [number, number] },
						properties: { label: searchPin.label },
					},
				],
			},
			pickable: false,
			stroked: true,
			filled: true,
			pointRadiusUnits: "pixels" as const,
			pointRadiusMinPixels: 10,
			pointRadiusMaxPixels: 28,
			getPointRadius: 12,
			getFillColor: [14, 165, 233, 230],
			getLineColor: [255, 255, 255, 255],
			getLineWidth: 3,
			lineWidthUnits: "pixels" as const,
		})
		// Pulsing outer ring — separate layer so we can animate opacity independently
		const pinRing = new GeoJsonLayer({
			id: "__search-pin-ring",
			data: {
				type: "FeatureCollection" as const,
				features: [
					{
						type: "Feature" as const,
						geometry: { type: "Point" as const, coordinates: [searchPin.lon, searchPin.lat] as [number, number] },
						properties: {},
					},
				],
			},
			pickable: false,
			stroked: true,
			filled: false,
			pointRadiusUnits: "pixels" as const,
			pointRadiusMinPixels: 16,
			pointRadiusMaxPixels: 40,
			getPointRadius: 20,
			getLineColor: [14, 165, 233, 120],
			getLineWidth: 2,
			lineWidthUnits: "pixels" as const,
		})
		return [pinPoint, pinRing]
	}, [searchPin])

	const allLayers = [basemapLayer, ...dataLayers, measureLayer, drawLayer, ...measureLabels, ...searchPinLayers].filter(
		Boolean,
	) as any[]

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
				getCursor={({ isDragging }: { isDragging: boolean }) => {
					if (isDragging) {
						return "grabbing"
					}
					if (measureMode || drawMode) {
						return "crosshair"
					}
					if (clickedFeatures.length > 0 || inspectPoint) {
						return "pointer"
					}
					return "grab"
				}}
				getTooltip={layers.length > 0 && clickedFeatures.length === 0 ? getTooltip : undefined}
				layers={allLayers}
				onClick={handleMapClick}
				onHover={({ coordinate }: any) => {
					if (coordinate && Array.isArray(coordinate) && coordinate.length >= 2) {
						const lon = coordinate[0]
						const lat = coordinate[1]
						setCursorCoord({ lon, lat })
						if (measureMode || (drawMode && !pendingDraw)) {
							setToolHoverCoord({ lon, lat })
						} else {
							setToolHoverCoord(null)
						}
					} else {
						setCursorCoord(null)
						setToolHoverCoord(null)
					}
				}}
				onViewStateChange={({ viewState: nextViewState }) => setViewState(nextViewState as MapViewState)}
				pickingRadius={8}
				style={{ position: "absolute", inset: "0" }}
				viewState={viewState}
			/>

			{layers.length === 0 && <MapEmptyState mapStyle={mapStyle} />}

			{/* Search pin clear button */}
			{searchPin && (
				<div className="map-search-pin-card">
					<span className="map-search-pin-icon">📍</span>
					<span className="map-search-pin-label">{searchPin.label}</span>
					<button
						aria-label="Clear search pin"
						className="map-search-pin-clear"
						onClick={() => setSearchPin(null)}
						title="Clear pin"
						type="button">
						✕
					</button>
				</div>
			)}

			<MeasureTool
				clickRef={measureClickRef}
				hoverCoord={toolHoverCoord}
				mapStyle={mapStyle === "dark" ? "dark" : "light"}
				mode={measureMode}
				onClose={() => {
					setMeasureMode(null)
					setMeasureGeometry(null)
					setToolHoverCoord(null)
				}}
				onGeometryChange={setMeasureGeometry}
			/>

			<VectorDrawTool
				clickRef={drawClickRef}
				hoverCoord={toolHoverCoord}
				mapStyle={mapStyle === "dark" ? "dark" : "light"}
				mode={pendingDraw ? null : drawMode}
				onCancel={() => {
					setDrawMode(null)
					setDrawGeometry(null)
					setToolHoverCoord(null)
				}}
				onComplete={(result) => {
					setDrawMode(null)
					setToolHoverCoord(null)
					setPendingDraw(result)
					try {
						setDrawGeometry(JSON.parse(result.geojson))
					} catch {
						setDrawGeometry(null)
					}
				}}
				onGeometryChange={setDrawGeometry}
			/>

			{pendingDraw && (
				<VectorSavePanel
					busy={saveVectorBusy}
					draw={pendingDraw}
					mapStyle={mapStyle}
					onDiscard={() => {
						setPendingDraw(null)
						setDrawGeometry(null)
					}}
					onExport={() => {
						const blob = new Blob([pendingDraw.geojson], { type: "application/geo+json" })
						const url = URL.createObjectURL(blob)
						const a = document.createElement("a")
						a.href = url
						a.download = `${pendingDraw.mode}.geojson`
						a.click()
						URL.revokeObjectURL(url)
					}}
					onSave={async (name) => {
						setSaveVectorBusy(true)
						try {
							const { SaveRoiToWorkspaceRequest } = await import("@shared/proto/cline/map")
							const { MapServiceClient } = await import("../../services/grpc-client")
							const res = await MapServiceClient.saveRoiToWorkspace(
								SaveRoiToWorkspaceRequest.create({
									name,
									roi: {
										name,
										source: "map_draw",
										geojson: pendingDraw.geojson,
										areaHa: (pendingDraw.areaKm2 ?? 0) * 100,
									},
								}),
							)
							reportMapEvent("user.file_saved", { path: res.workspacePath, mode: pendingDraw.mode })
							setPendingDraw(null)
							setDrawGeometry(null)
						} catch (err) {
							console.error("[MapView] Save vector failed:", err)
							window.alert(err instanceof Error ? err.message : "Failed to save vector")
						} finally {
							setSaveVectorBusy(false)
						}
					}}
				/>
			)}

			<MapToolRibbon
				clusterLayerIds={clusterLayerIds}
				currentBasemap={selectedBaseMap}
				drawMode={drawMode}
				exportOpen={exportOpen}
				layerCount={layers.length}
				layerOpacities={layerOpacities}
				layerOrder={layerOrder}
				mapStyle={mapStyle === "dark" ? "dark" : "light"}
				measureMode={measureMode}
				onBasemapChange={setSelectedBaseMap}
				onClusterToggle={handleClusterToggle}
				onDrawModeChange={(m) => {
					setMeasureMode(null)
					setPendingDraw(null)
					setDrawMode(m)
				}}
				onExportToggle={() => setExportOpen((v) => !v)}
				onFitExtent={handleFitExtent}
				onHideAllLayers={() => setVisibleLayerIds(new Set())}
				onMeasureModeChange={(m) => {
					setDrawMode(null)
					setMeasureMode(m)
				}}
				onOpacityChange={handleOpacityChange}
				onReorder={setLayerOrder}
				onSearchToggle={() => setSearchOpen((v) => !v)}
				onShowAllLayers={() => setVisibleLayerIds(new Set(layers.map((l) => l.id)))}
				onVisibilityChange={handleVisibilityChange}
				onZoomToLayer={handleZoomToLayer}
				searchOpen={searchOpen}
				searchPanel={
					<SearchBar
						embedded
						mapCenter={{ lat: viewState.latitude, lon: viewState.longitude }}
						onResultSelect={(result) => {
							setViewState((prev) => ({
								...prev,
								longitude: result.lon,
								latitude: result.lat,
								zoom: result.bbox ? Math.min(16, prev.zoom + 3) : 12,
							}))
							setSearchPin({ lon: result.lon, lat: result.lat, label: result.label })
							setSearchStatus("")
						}}
						onStatus={setSearchStatus}
						viewBbox={mapViewBbox()}
					/>
				}
				searchStatus={searchStatus}
				viewState={viewState}
				visibleLayerIds={visibleLayerIds}
			/>

			<MapLegend
				cursorReading={cursorRasterReading}
				layers={sortedLayers}
				mapStyle={mapStyle}
				visibleLayerIds={visibleLayerIds}
			/>

			<FeatureIdentifier
				agentStarting={agentStarting}
				agentStatus={agentStatus}
				delineateStatus={delineateStatus}
				delineating={delineating}
				features={clickedFeatures}
				inspectPoint={inspectPoint}
				mapStyle={mapStyle}
				onAgentAsk={async (pt) => {
					setAgentStarting(true)
					setAgentStatus(null)
					setDelineateStatus(null)
					const ctx = buildMapAgentContext(pt, clickedFeatures, sortedLayers, visibleLayerIds)
					try {
						const result = await askAgentAboutMap(ctx)
						setAgentStatus(
							result.ok
								? "Chat opened — edit the prompt and send when ready."
								: result.error || "Could not start agent task",
						)
					} catch (e) {
						setAgentStatus(e instanceof Error ? e.message : String(e))
					} finally {
						setAgentStarting(false)
					}
				}}
				onAgentDelineate={async (pt) => {
					setAgentStarting(true)
					setAgentStatus(null)
					setDelineateStatus(null)
					const ctx = buildMapAgentContext(pt, clickedFeatures, sortedLayers, visibleLayerIds)
					try {
						const result = await askAgentToDelineate(ctx)
						setAgentStatus(
							result.ok
								? "Chat opened — agent will delineate and push to map."
								: result.error || "Could not start agent task",
						)
					} catch (e) {
						setAgentStatus(e instanceof Error ? e.message : String(e))
					} finally {
						setAgentStarting(false)
					}
				}}
				onClose={() => {
					setClickedFeatures([])
					setInspectPoint(null)
					setInspectRasterReading(null)
					setDelineateStatus(null)
					setAgentStatus(null)
				}}
				onQuickDelineate={async (pt) => {
					if (!isConus(pt.lat, pt.lon) && !hasMeritRiversOnMap(sortedLayers, visibleLayerIds)) {
						setDelineateStatus(meritRiversRequiredMessage())
						return
					}
					reportMapEvent("delineation.requested", { lat: pt.lat, lon: pt.lon })
					setDelineating(true)
					setDelineateStatus(null)
					setAgentStatus(null)
					try {
						const result = await sendHydroMapCommand("delineatePoint", {
							lat: pt.lat,
							lon: pt.lon,
							sessionId: "map",
							method: "auto",
						})
						if (result.ok) {
							const area = (result.result?.data as { area_km2?: number })?.area_km2
							const method = (result.result?.data as { method_used?: string })?.method_used
							setDelineateStatus(
								area != null
									? `Done: ${Number(area).toFixed(1)} km² (${method || "auto"})`
									: result.message || "Watershed added to map",
							)
							reportMapEvent("delineation.completed", {
								lat: pt.lat,
								lon: pt.lon,
								area_km2: area,
								method_used: method,
							})
							handleFitExtent()
						} else {
							setDelineateStatus(result.error || result.message || "Delineation failed")
						}
					} catch (e) {
						setDelineateStatus(e instanceof Error ? e.message : String(e))
					} finally {
						setDelineating(false)
					}
				}}
				rasterReading={inspectRasterReading}
			/>

			<MapBottomBar
				bearing={viewState.bearing}
				cursorCoord={cursorCoord}
				mapStyle={mapStyle}
				onResetNorth={() => setViewState((prev) => ({ ...prev, bearing: 0, pitch: 0 }))}
				onZoomIn={() => setViewState((prev) => ({ ...prev, zoom: Math.min(20, prev.zoom + 1) }))}
				onZoomOut={() => setViewState((prev) => ({ ...prev, zoom: Math.max(0, prev.zoom - 1) }))}
				selectedBaseMap={selectedBaseMap}
				viewState={viewState}
			/>

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

			{/* Keyboard shortcut help */}
			<KeyboardShortcutsHelp mapStyle={mapStyle} />
		</div>
	)
}

// ─── Empty State ────────────────────────────────────────────────────────────

const MapEmptyState: React.FC<{ mapStyle: string }> = ({ mapStyle }) => {
	const isDark = mapStyle === "dark"
	return (
		<div className={`map-empty-state ${isDark ? "map-empty-state--dark" : "map-empty-state--light"}`}>
			<div className="map-empty-ripple" />
			<div className="map-empty-ripple" style={{ animationDelay: "1.5s" }} />
			<div className="map-empty-ripple" style={{ animationDelay: "3s" }} />
			<div className="map-empty-content">
				<div className="map-empty-icon">🗺️</div>
				<h2 className="map-empty-title">AI-Hydro Map</h2>
				<p className="map-empty-subtitle">No layers yet — run a hydrological analysis or push a layer to get started.</p>
				<div className="map-empty-actions">
					<div className="map-empty-action">
						<span className="map-empty-action-icon">📥</span>
						<span>Drop a GeoJSON file</span>
					</div>
					<div className="map-empty-action">
						<span className="map-empty-action-icon">🔍</span>
						<span>Search for a gauge</span>
					</div>
					<div className="map-empty-action">
						<span className="map-empty-action-icon">🌊</span>
						<span>Run a watershed tool</span>
					</div>
				</div>
			</div>
		</div>
	)
}

// ─── Unified Bottom Bar (zoom + compass + scale + coords + attribution) ─────

const MapBottomBar: React.FC<{
	bearing: number
	cursorCoord: { lon: number; lat: number } | null
	mapStyle: string
	onResetNorth: () => void
	onZoomIn: () => void
	onZoomOut: () => void
	selectedBaseMap: string
	viewState: MapViewState
}> = ({ bearing, cursorCoord, mapStyle, onResetNorth, onZoomIn, onZoomOut, selectedBaseMap, viewState }) => {
	const isDark = mapStyle === "dark"
	const fg = isDark ? "rgba(255,255,255,0.92)" : "rgba(0,0,0,0.85)"
	const bg = isDark ? "rgba(20,20,28,0.70)" : "rgba(255,255,255,0.85)"
	const border = isDark ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.18)"

	// Scale bar
	const { widthPx, label } = useMemo(() => {
		const metersPerPixel =
			(156543.03392 * Math.cos(((cursorCoord?.lat ?? viewState.latitude) * Math.PI) / 180)) / 2 ** viewState.zoom
		const targetMeters = metersPerPixel * 120
		const niceSteps = [
			1, 2, 5, 10, 20, 50, 100, 200, 500, 1_000, 2_000, 5_000, 10_000, 20_000, 50_000, 100_000, 200_000, 500_000, 1_000_000,
			2_000_000, 5_000_000,
		]
		const stepMeters = niceSteps.find((s) => s > targetMeters) ?? niceSteps[niceSteps.length - 1]
		const widthPx = Math.max(20, Math.min(300, stepMeters / metersPerPixel))
		const label = stepMeters >= 1000 ? `${stepMeters / 1000} km` : `${stepMeters} m`
		return { widthPx, label }
	}, [viewState.zoom, viewState.latitude, cursorCoord?.lat])

	// Coordinate format cycling
	const [coordFormat, setCoordFormat] = useState<"decimal" | "dms" | "utm">("decimal")
	const cycleFormat = () => setCoordFormat((f) => (f === "decimal" ? "dms" : f === "dms" ? "utm" : "decimal"))

	const formatDecimal = (lon: number, lat: number) => {
		const lonHem = lon >= 0 ? "E" : "W"
		const latHem = lat >= 0 ? "N" : "S"
		return `${Math.abs(lat).toFixed(4)}°${latHem}, ${Math.abs(lon).toFixed(4)}°${lonHem}`
	}

	const toDMS = (deg: number, isLat: boolean) => {
		const abs = Math.abs(deg)
		const d = Math.floor(abs)
		const m = Math.floor((abs - d) * 60)
		const s = ((abs - d) * 60 - m) * 60
		const dir = isLat ? (deg >= 0 ? "N" : "S") : deg >= 0 ? "E" : "W"
		return `${d}°${m.toString().padStart(2, "0")}'${s.toFixed(1).padStart(4, "0")}"${dir}`
	}

	const formatDMS = (lon: number, lat: number) => `${toDMS(lat, true)}  ${toDMS(lon, false)}`

	const utmZone = (lon: number) => Math.floor((lon + 180) / 6) + 1

	const formatUTM = (lon: number, lat: number) => {
		const zone = utmZone(lon)
		const k0 = 0.9996
		const a = 6378137
		const e2 = 0.00669438
		const e2p = e2 / (1 - e2)
		const latRad = (lat * Math.PI) / 180
		const lonRad = (lon * Math.PI) / 180
		const lon0 = ((zone - 1) * 6 - 180 + 3) * (Math.PI / 180)
		const N = a / Math.sqrt(1 - e2 * Math.sin(latRad) ** 2)
		const T = Math.tan(latRad) ** 2
		const C = e2p * Math.cos(latRad) ** 2
		const A = Math.cos(latRad) * (lonRad - lon0)
		const M =
			a *
			((1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256) * latRad -
				((3 * e2) / 8 + (3 * e2 ** 2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * latRad) +
				((15 * e2 ** 2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * latRad) -
				((35 * e2 ** 3) / 3072) * Math.sin(6 * latRad))
		const x = k0 * N * (A + ((1 - T + C) * A ** 3) / 6 + ((5 - 18 * T + T ** 2 + 72 * C - 58 * e2p) * A ** 5) / 120)
		const y =
			k0 *
			(M +
				N *
					Math.tan(latRad) *
					(A ** 2 / 2 +
						((5 - T + 9 * C + 4 * C ** 2) * A ** 4) / 24 +
						((61 - 58 * T + T ** 2 + 600 * C - 330 * e2p) * A ** 6) / 720))
		const easting = 500000 + x
		const northing = lat < 0 ? 10000000 + y : y
		const hemi = lat < 0 ? "S" : "N"
		return `${zone}${hemi}  ${Math.round(easting)}mE  ${Math.round(northing)}mN`
	}

	const formatLatLon = (lon: number, lat: number, fmt: "decimal" | "dms" | "utm") => {
		switch (fmt) {
			case "dms":
				return formatDMS(lon, lat)
			case "utm":
				return formatUTM(lon, lat)
			default:
				return formatDecimal(lon, lat)
		}
	}

	// Attribution
	const baseMapStyle = BASE_MAP_STYLES.find((s) => s.id === selectedBaseMap)
	const attribution = baseMapStyle?.attribution ?? ""

	return (
		<div className="map-bottom-bar" style={{ background: bg, borderColor: border, color: fg }}>
			{/* Zoom controls */}
			<div className="map-bottom-bar-group">
				<button aria-label="Zoom in" className="map-zoom-btn" onClick={onZoomIn} title="Zoom in" type="button">
					+
				</button>
				<button aria-label="Zoom out" className="map-zoom-btn" onClick={onZoomOut} title="Zoom out" type="button">
					−
				</button>
			</div>

			{/* Compass */}
			{bearing !== 0 && (
				<button
					aria-label="Reset north"
					className="map-compass-btn"
					onClick={onResetNorth}
					style={{ transform: `rotate(${-bearing}deg)` }}
					title="Reset north"
					type="button">
					⬆
				</button>
			)}

			{/* Scale bar */}
			<div className="map-scale-bar">
				<div className="map-scale-ruler" style={{ width: widthPx }} />
				<span className="map-scale-label">{label}</span>
			</div>

			{/* Coordinates */}
			<button
				className="map-coords-btn"
				onClick={cycleFormat}
				onDoubleClick={(e) => {
					e.preventDefault()
					if (!cursorCoord) {
						return
					}
					const text = formatLatLon(cursorCoord.lon, cursorCoord.lat, coordFormat)
					void navigator.clipboard?.writeText(text)
				}}
				title="Click to cycle format; double-click to copy coordinates">
				{cursorCoord ? formatLatLon(cursorCoord.lon, cursorCoord.lat, coordFormat) : `z ${viewState.zoom.toFixed(2)}`}
			</button>

			{/* Attribution */}
			{attribution && <span className="map-attribution">{attribution}</span>}
		</div>
	)
}

// ─── Keyboard Shortcuts Help ────────────────────────────────────────────────

const KeyboardShortcutsHelp: React.FC<{ mapStyle: string }> = ({ mapStyle }) => {
	const [showHelp, setShowHelp] = useState(false)
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey) {
				// Only if not typing in an input
				const target = e.target as HTMLElement
				if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
					return
				}
				setShowHelp((v) => !v)
			}
		}
		window.addEventListener("keydown", handler)
		return () => window.removeEventListener("keydown", handler)
	}, [])
	if (!showHelp) {
		return null
	}
	const isDark = mapStyle === "dark"
	const bg = isDark ? "rgba(20,20,28,0.96)" : "rgba(248,248,250,0.97)"
	const fg = isDark ? "var(--vscode-foreground, #ddd)" : "var(--vscode-foreground, #222)"
	const border = isDark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.14)"
	const shortcuts = [
		{ key: "?", desc: "Toggle this help" },
		{ key: "ESC", desc: "Close panel / cancel measure" },
		{ key: "Enter", desc: "Finish measurement" },
		{ key: "Ctrl + scroll", desc: "Zoom map" },
	]
	return (
		<div
			style={{
				position: "absolute",
				inset: 0,
				zIndex: 20,
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				background: "rgba(0,0,0,0.35)",
				backdropFilter: "blur(2px)",
			}}>
			<div
				style={{
					background: bg,
					color: fg,
					border: `1px solid ${border}`,
					borderRadius: 6,
					padding: "14px 18px",
					minWidth: 260,
					boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
					fontFamily: "var(--vscode-font-family, system-ui, sans-serif)",
					fontSize: 12,
				}}>
				<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
					<span style={{ fontWeight: 600, fontSize: 13 }}>Keyboard Shortcuts</span>
					<button
						onClick={() => setShowHelp(false)}
						style={{
							background: "transparent",
							border: "none",
							color: fg,
							cursor: "pointer",
							fontSize: 13,
						}}
						type="button">
						✕
					</button>
				</div>
				{shortcuts.map((s) => (
					<div
						key={s.key}
						style={{
							display: "flex",
							alignItems: "center",
							gap: 10,
							padding: "4px 0",
							borderBottom: `1px solid ${border}`,
						}}>
						<code
							style={{
								fontFamily: "var(--vscode-editor-font-family, monospace)",
								fontSize: 10,
								background: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
								padding: "2px 6px",
								borderRadius: 3,
								minWidth: 70,
								textAlign: "center",
							}}>
							{s.key}
						</code>
						<span>{s.desc}</span>
					</div>
				))}
			</div>
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
	cursorReading: CursorRasterReading | null
}

/** Format a numeric raster value with adaptive precision. */
const fmtRasterValue = (v: number): string => {
	if (!Number.isFinite(v)) {
		return "—"
	}
	const abs = Math.abs(v)
	if (abs === 0) {
		return "0"
	}
	if (abs >= 1000) {
		return v.toFixed(0)
	}
	if (abs >= 10) {
		return v.toFixed(2)
	}
	if (abs >= 1) {
		return v.toFixed(3)
	}
	return v.toPrecision(3)
}

const RasterLegend: React.FC<RasterLegendProps> = ({ layers, visibleLayerIds, mapStyle, cursorReading }) => {
	const visibleRasters = layers.filter((l) => l.layerType === "raster" && visibleLayerIds.has(l.id))
	if (visibleRasters.length === 0) {
		return null
	}

	// Show legend for the topmost visible raster (last in render order).
	// If the cursor is over a different visible raster, the reading wins so the
	// legend always describes whatever pixel the user is actually pointing at.
	const layer = cursorReading
		? (visibleRasters.find((l) => l.id === cursorReading.layerId) ?? visibleRasters[visibleRasters.length - 1])
		: visibleRasters[visibleRasters.length - 1]
	const colormap = layer.metadata?.raster_colormap ?? "viridis"
	const minRaw = layer.metadata?.min ? parseFloat(layer.metadata.min) : NaN
	const maxRaw = layer.metadata?.max ? parseFloat(layer.metadata.max) : NaN
	const gradient = LEGEND_GRADIENTS[colormap] ?? LEGEND_GRADIENTS["viridis"]

	const isDark = mapStyle === "dark"
	const bg = isDark ? "rgba(18,18,26,0.88)" : "rgba(252,252,252,0.90)"
	const fg = isDark ? "rgba(255,255,255,0.85)" : "rgba(0,0,0,0.85)"
	const bdClr = isDark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.14)"
	const tickColor = isDark ? "#ffffff" : "#000000"

	// Live tick: position of cursor value on the gradient bar [0, 1]
	const showTick = cursorReading && Number.isFinite(minRaw) && Number.isFinite(maxRaw) && maxRaw > minRaw
	const tickPct = showTick ? Math.max(0, Math.min(1, (cursorReading.value - minRaw) / (maxRaw - minRaw))) : 0

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
				minWidth: 170,
				maxWidth: 220,
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
			{/* Gradient bar with live cursor tick */}
			<div style={{ position: "relative", marginBottom: 3 }}>
				<div style={{ height: 10, background: gradient, borderRadius: 2, border: `1px solid ${bdClr}` }} />
				{showTick && (
					<>
						{/* Vertical tick marker */}
						<div
							style={{
								position: "absolute",
								top: -2,
								left: `calc(${(tickPct * 100).toFixed(2)}% - 1px)`,
								width: 2,
								height: 14,
								background: tickColor,
								boxShadow: "0 0 0 1px rgba(0,0,0,0.55), 0 0 4px rgba(255,255,255,0.45)",
								borderRadius: 1,
							}}
						/>
						{/* Caret above the tick */}
						<div
							style={{
								position: "absolute",
								top: -7,
								left: `calc(${(tickPct * 100).toFixed(2)}% - 4px)`,
								width: 0,
								height: 0,
								borderLeft: "4px solid transparent",
								borderRight: "4px solid transparent",
								borderTop: `5px solid ${tickColor}`,
								filter: "drop-shadow(0 0 1px rgba(0,0,0,0.6))",
							}}
						/>
					</>
				)}
			</div>
			{/* Min / max labels */}
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					fontSize: 9,
					opacity: 0.78,
					fontVariantNumeric: "tabular-nums",
				}}>
				<span>{Number.isFinite(minRaw) ? fmtRasterValue(minRaw) : "—"}</span>
				<span>{Number.isFinite(maxRaw) ? fmtRasterValue(maxRaw) : "—"}</span>
			</div>
			{/* Live cursor value */}
			<div
				style={{
					marginTop: 4,
					paddingTop: 4,
					borderTop: `1px dashed ${bdClr}`,
					display: "flex",
					alignItems: "baseline",
					gap: 6,
					fontVariantNumeric: "tabular-nums",
					minHeight: 14,
				}}>
				<span style={{ fontSize: 9, opacity: 0.65 }}>cursor</span>
				<span style={{ fontSize: 12, fontWeight: 600, opacity: cursorReading ? 1 : 0.3 }}>
					{cursorReading ? fmtRasterValue(cursorReading.value) : "—"}
				</span>
				{cursorReading?.units && <span style={{ fontSize: 9, opacity: 0.6 }}>{cursorReading.units}</span>}
			</div>
		</div>
	)
}

export default MapView
