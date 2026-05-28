/**
 * LayerPanel — layer manager content.
 *
 *  Compact icon-toolbar per layer (hover for label), inspired by QGIS/ArcGIS layer panel:
 *    👁 visibility · swatch symbology · 🔍 zoom · 📊 attributes · 💾 export · ↑↓ reorder · ✕ remove
 *
 *  Features:
 *  • Drag-handle reorder: grab the ⠿ gripper and drag a layer row up/down
 *  • Per-row "show all metadata" toggle and global "ⓘ" toggle
 *  • Per-layer symbology editor
 *  • Source badges: 📁 workspace · 🐍 tool · 📥 loaded · 📤 pushed
 *  • Panel state persisted via mapWorkspace localStorage
 *
 * Positioning is the parent's responsibility (see MapToolRibbon).
 */

import { StringRequest } from "@shared/proto/cline/common"
import type { MapLayer } from "@shared/proto/cline/map"
import { AddMapLayerRequest, RemoveMapLayerRequest, SaveRoiToWorkspaceRequest } from "@shared/proto/cline/map"
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { PLATFORM_CONFIG } from "../../config/platform.config"
import { useMapContext } from "../../context/MapContext"
import { FileServiceClient, MapServiceClient } from "../../services/grpc-client"
import { ACCEPTED_EXTENSIONS, loadAndPushFileEntries, loadAndPushFiles } from "./formats"
import { rasterCache } from "./formats/rasterCache"
import GraduatedSymbologyEditor from "./GraduatedSymbologyEditor"
import { deriveLayerIntelligence, type LayerIntelligence, warningText } from "./layerIntelligence"
import { geeDisplayLines } from "./mapLayerAdapters"
import { loadMapWorkspace, saveMapWorkspace } from "./mapWorkspace"
import { SymbologyEditor } from "./SymbologyEditor"

interface LayerPanelContentProps {
	onZoomToLayer?: (layer: MapLayer) => void
	onVisibilityChange: (layerId: string, visible: boolean) => void
	onOpacityChange?: (layerId: string, opacity: number) => void
	visibleLayerIds: Set<string>
	mapStyle?: string
	layerOrder: string[]
	onReorder: (newOrder: string[]) => void
	layerOpacities?: Record<string, number>
	clusterLayerIds?: Set<string>
	onClusterToggle?: (layerId: string, enabled: boolean) => void
	onShowAllLayers?: () => void
	onHideAllLayers?: () => void
}

// ─── helpers ────────────────────────────────────────────────────────────────

const layerTypeIcon = (t?: string): string => {
	switch ((t || "").toLowerCase()) {
		case "point":
			return "●"
		case "line":
			return "〰"
		case "polygon":
			return "⬡"
		case "raster":
			return "▦"
		case "gee_tile":
			return "◉"
		default:
			return "◈"
	}
}

const sourceBadge = (layer: MapLayer): { icon: string; title: string } => {
	const s = layer.metadata?.source
	if (s === "gee") return { icon: "🛰", title: "Google Earth Engine layer" }
	if (s === "workspace") return { icon: "📁", title: "Workspace file" }
	if (s === "user") return { icon: "📥", title: "Loaded by you" }
	if (layer.metadata?._run_id || layer.metadata?.tool) return { icon: "🐍", title: "Tool output" }
	return { icon: "📤", title: "Pushed layer" }
}

const HIDDEN_KEYS = new Set([
	"__operation",
	"source",
	"path",
	"lastModified",
	"originalFormat",
	"formatIcon",
	"raster_data_url",
	"raster_bounds",
	"raster_opacity",
	"raster_path",
	"raster_colormap",
	"raster_cached",
	"gee_tile_url_template",
	"gee_remote_tile_url_template",
	"addedAt",
	"source_uri",
	"source_path",
	"source_display_path",
	"source_format",
	"source_mtime_ms",
	"source_size_bytes",
	"source_loaded_at_utc",
	"source_status",
	"source_remote_url",
	"source_derived_from",
	"converted_artifact_path",
	"conversion",
])

const niceMetadata = (layer: MapLayer): Array<[string, string]> => {
	const out: Array<[string, string]> = []
	const meta = layer.metadata ?? {}
	if (layer.layerType !== "raster" && layer.geojson) {
		try {
			const p = JSON.parse(layer.geojson)
			if (p?.type === "FeatureCollection" && Array.isArray(p.features)) out.push(["features", String(p.features.length)])
		} catch {
			/* ignore */
		}
	}
	const PRIORITY = [
		"format",
		"crs",
		"reprojected",
		"units",
		"variable",
		"gee_dataset_id",
		"gee_start_date",
		"gee_end_date",
		"tool",
		"_run_id",
		"rows",
	]
	for (const k of PRIORITY) {
		if (meta[k]) out.push([k, meta[k]])
	}
	if (layer.layerType === "gee_tile") {
		for (const [k, v] of geeDisplayLines(layer)) {
			if (!out.some(([key]) => key === k)) {
				out.push([k, v])
			}
		}
	}
	return out
}

const openProvenance = async (path: string) => {
	try {
		await FileServiceClient.openFile(StringRequest.create({ value: path }))
	} catch (err) {
		console.error("[LayerPanel] Failed to open provenance:", err)
	}
}

const openSourceFile = (filePath: string) => {
	PLATFORM_CONFIG.postMessage({ type: "aihydro-open-source-file", path: filePath })
}

function newUiRequestId(prefix: string): string {
	return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function resolveSourceFileUri(filePath: string): Promise<{ uri: string; name: string }> {
	const requestId = newUiRequestId("source")
	return new Promise((resolve, reject) => {
		const timeout = window.setTimeout(() => {
			window.removeEventListener("message", onMessage)
			reject(new Error("Timed out resolving source file"))
		}, 30_000)
		const onMessage = (event: MessageEvent) => {
			const data = event.data
			if (!data || data.type !== "aihydro-resolve-file-uri-result" || data.requestId !== requestId) {
				return
			}
			window.clearTimeout(timeout)
			window.removeEventListener("message", onMessage)
			if (data.ok && typeof data.uri === "string") {
				resolve({ uri: data.uri, name: data.name ?? filePath.split("/").pop() ?? "layer" })
			} else {
				reject(new Error(data.error ?? "Could not resolve source file"))
			}
		}
		window.addEventListener("message", onMessage)
		PLATFORM_CONFIG.postMessage({ type: "aihydro-resolve-file-uri", requestId, path: filePath })
	})
}

const allMetadata = (layer: MapLayer): Array<[string, string]> =>
	Object.entries(layer.metadata ?? {}).filter(([k]) => !HIDDEN_KEYS.has(k) && !k.startsWith("__"))

const colorSwatch = (layer: MapLayer): string => {
	if (layer.layerType === "gee_tile") {
		return "linear-gradient(to right, #081d58, #225ea8, #41b6c4, #a1dab4, #ffffcc)"
	}
	if (layer.layerType === "raster") {
		const cmap = layer.metadata?.raster_colormap ?? "viridis"
		const gradients: Record<string, string> = {
			viridis: "linear-gradient(to right, #440154, #31688e, #35b779, #fde725)",
			viridis_r: "linear-gradient(to right, #fde725, #35b779, #31688e, #440154)",
			YlOrRd: "linear-gradient(to right, #ffffb2, #fecc5c, #fd8d3c, #e31a1c)",
			Blues: "linear-gradient(to right, #f7fbff, #6baed6, #2171b5, #084594)",
			RdYlGn: "linear-gradient(to right, #d73027, #fee08b, #1a9850)",
			plasma: "linear-gradient(to right, #0d0887, #cc4778, #f0f921)",
			magma: "linear-gradient(to right, #000004, #b73779, #fcfdbf)",
			cividis: "linear-gradient(to right, #00224e, #7c7b78, #fde737)",
		}
		return gradients[cmap] ?? "linear-gradient(to right, #440154, #fde725)"
	}
	return layer.style?.fillColor || layer.style?.color || "#0066CC"
}

const statusColors = (dataState: LayerIntelligence["dataState"]) => {
	switch (dataState) {
		case "analysis_ready_raster":
			return { bg: "rgba(43, 183, 117, 0.14)", fg: "#6ee7a8", bd: "rgba(43, 183, 117, 0.32)" }
		case "visual_preview_raster":
			return { bg: "rgba(255, 190, 80, 0.14)", fg: "#ffc857", bd: "rgba(255, 190, 80, 0.34)" }
		case "remote_raster":
			return { bg: "rgba(93, 173, 226, 0.14)", fg: "#7cc7ff", bd: "rgba(93, 173, 226, 0.32)" }
		case "reference_vector":
			return { bg: "rgba(52, 211, 153, 0.12)", fg: "#8ee8d1", bd: "rgba(52, 211, 153, 0.28)" }
		case "analysis_output":
			return { bg: "rgba(147, 197, 253, 0.12)", fg: "#a9d0ff", bd: "rgba(147, 197, 253, 0.28)" }
		default:
			return { bg: "rgba(255,255,255,0.08)", fg: "inherit", bd: "rgba(255,255,255,0.16)" }
	}
}

const buildDisplayNames = (layers: MapLayer[], aliases: Record<string, string>): Map<string, string> => {
	const counts = new Map<string, number>()
	for (const l of layers) {
		const n = aliases[l.id] ?? l.metadata?.display_name ?? (l.name || l.id)
		counts.set(n, (counts.get(n) ?? 0) + 1)
	}
	const out = new Map<string, string>()
	for (const l of layers) {
		if (aliases[l.id]) {
			out.set(l.id, aliases[l.id])
			continue
		}
		const base = l.name || l.id
		if ((counts.get(base) ?? 0) <= 1) {
			out.set(l.id, base)
			continue
		}
		const folder = (l.metadata?.path ?? "").replace(/\\/g, "/").split("/").slice(0, -1).join("/")
		out.set(l.id, folder ? `${base} — ${folder}` : base)
	}
	return out
}

/** Download a layer's content as a file. */
const exportLayer = (layer: MapLayer, displayName: string) => {
	if (layer.layerType === "raster") return // raster export not yet supported
	if (!layer.geojson) return
	const blob = new Blob([layer.geojson], { type: "application/json" })
	const url = URL.createObjectURL(blob)
	const a = document.createElement("a")
	a.href = url
	a.download = `${displayName.replace(/[^a-zA-Z0-9_-]/g, "_")}.geojson`
	a.click()
	URL.revokeObjectURL(url)
}

const saveLayerToWorkspace = async (layer: MapLayer, displayName: string): Promise<string> => {
	if (!layer.geojson) {
		throw new Error("Layer has no vector geometry to save.")
	}
	const safeName = displayName.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/^_+|_+$/g, "") || "map_layer"
	const res = await MapServiceClient.saveRoiToWorkspace(
		SaveRoiToWorkspaceRequest.create({
			name: safeName,
			roi: {
				name: displayName,
				source: "map_layer",
				geojson: layer.geojson,
			},
		}),
	)
	return res.workspacePath
}

// ─── component ──────────────────────────────────────────────────────────────

export const LayerPanelContent: React.FC<LayerPanelContentProps> = ({
	onZoomToLayer,
	onVisibilityChange,
	onOpacityChange,
	visibleLayerIds,
	mapStyle = "dark",
	layerOrder,
	onReorder,
	layerOpacities = {},
	clusterLayerIds,
	onClusterToggle,
	onShowAllLayers,
	onHideAllLayers,
}) => {
	const { layers } = useMapContext()
	const persisted = useMemo(() => loadMapWorkspace(), [])
	const [showDetails, setShowDetails] = useState<boolean>(persisted.layerPanel?.showDetails ?? false)
	const [layerAliases, setLayerAliases] = useState<Record<string, string>>(persisted.layerAliases ?? {})
	const [renamingId, setRenamingId] = useState<string | null>(null)
	const [renameDraft, setRenameDraft] = useState("")
	const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
	const [attrTableFor, setAttrTableFor] = useState<string | null>(null)
	const [symbologyFor, setSymbologyFor] = useState<string | null>(null)
	const [symbologyMode, setSymbologyMode] = useState<"basic" | "graduated">("basic")
	const [confirmingClear, setConfirmingClear] = useState(false)
	const [loadStatus, setLoadStatus] = useState<{ kind: "idle" | "ok" | "err"; msg: string }>({ kind: "idle", msg: "" })
	const [savingLayerId, setSavingLayerId] = useState<string | null>(null)

	// Drag-to-reorder rows
	const rowDragRef = useRef<{ dragId: string; overIndex: number } | null>(null)
	const fileInputRef = useRef<HTMLInputElement>(null)

	useEffect(() => {
		saveMapWorkspace({ layerPanel: { showDetails } })
	}, [showDetails])

	useEffect(() => {
		saveMapWorkspace({ layerAliases })
	}, [layerAliases])

	const isDark = mapStyle === "dark"
	const fg = isDark ? "var(--vscode-foreground, #ddd)" : "var(--vscode-foreground, #222)"
	const border = isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.12)"
	const subtle = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)"
	const danger = "#dc3545"

	const displayNames = useMemo(() => buildDisplayNames(layers, layerAliases), [layers, layerAliases])

	const commitRename = async (layer: MapLayer) => {
		const trimmed = renameDraft.trim()
		const layerId = layer.id
		setRenamingId(null)
		setRenameDraft("")
		const baseName = layer.name || layer.id
		if (!trimmed || trimmed === baseName) {
			setLayerAliases((prev) => {
				const next = { ...prev }
				delete next[layerId]
				return next
			})
			return
		}
		try {
			const metadata = { ...(layer.metadata ?? {}), display_name: trimmed }
			await MapServiceClient.addMapLayer(
				AddMapLayerRequest.create({
					layer: { ...layer, name: trimmed, metadata },
					replaceExisting: true,
				}),
			)
			setLayerAliases((prev) => {
				const next = { ...prev }
				delete next[layerId]
				return next
			})
		} catch (err) {
			console.error("[LayerPanel] Failed to save layer name:", err)
			setLayerAliases((prev) => ({ ...prev, [layerId]: trimmed }))
		}
	}

	const handleSaveLayerToWorkspace = async (layer: MapLayer, displayName: string) => {
		setSavingLayerId(layer.id)
		try {
			const workspacePath = await saveLayerToWorkspace(layer, displayName)
			setLoadStatus({ kind: "ok", msg: `Saved ${workspacePath}` })
			window.setTimeout(() => setLoadStatus({ kind: "idle", msg: "" }), 3500)
		} catch (err) {
			setLoadStatus({ kind: "err", msg: err instanceof Error ? err.message : "Save failed" })
		} finally {
			setSavingLayerId(null)
		}
	}

	const handleReloadSource = async (layer: MapLayer, displayName: string) => {
		const sourcePath = layer.metadata?.source_path || layer.metadata?.path || layer.metadata?.raster_source_path
		if (!sourcePath) {
			setLoadStatus({ kind: "err", msg: "No source file path recorded for this layer." })
			return
		}
		setLoadStatus({ kind: "idle", msg: `Reloading ${displayName}…` })
		try {
			const resolved = await resolveSourceFileUri(sourcePath)
			const response = await fetch(resolved.uri)
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`)
			}
			const blob = await response.blob()
			const file = new File([blob], resolved.name)
			const result = await loadAndPushFileEntries([
				{
					file,
					source: {
						path: sourcePath,
						uri: layer.metadata?.source_uri,
						displayPath: layer.metadata?.source_display_path ?? sourcePath,
						format: layer.metadata?.source_format ?? layer.metadata?.format,
					},
				},
			])
			if (result.loaded > 0) {
				setLoadStatus({ kind: "ok", msg: `Reloaded ${displayName}.` })
			} else {
				setLoadStatus({ kind: "err", msg: result.errors[0] ?? "Reload failed." })
			}
		} catch (err) {
			setLoadStatus({ kind: "err", msg: err instanceof Error ? err.message : "Reload failed." })
		}
		window.setTimeout(() => setLoadStatus({ kind: "idle", msg: "" }), 5000)
	}

	// Sorted layer list respects the custom order maintained in MapView
	const orderedLayers = useMemo(() => {
		if (layerOrder.length === 0) return layers
		const byId = new Map(layers.map((l) => [l.id, l]))
		const sorted = layerOrder.map((id) => byId.get(id)).filter(Boolean) as MapLayer[]
		// Append any layers not yet in the order list
		const inOrder = new Set(layerOrder)
		for (const l of layers) if (!inOrder.has(l.id)) sorted.push(l)
		return sorted
	}, [layers, layerOrder])

	const toggleRowDetails = (id: string) =>
		setExpandedRows((prev) => {
			const next = new Set(prev)
			next.has(id) ? next.delete(id) : next.add(id)
			return next
		})

	const handleRemove = async (id: string) => {
		try {
			await MapServiceClient.removeMapLayer(RemoveMapLayerRequest.create({ layerId: id }))
		} catch (err) {
			console.error("Failed to remove layer:", err)
		}
	}

	const handleClearAll = async () => {
		try {
			await MapServiceClient.clearMapLayers({})
		} catch (err) {
			console.error("Failed to clear layers:", err)
		} finally {
			setConfirmingClear(false)
		}
	}

	// ── row drag-to-reorder ───────────────────────────────────────────────
	const onRowDragStart = useCallback((e: React.DragEvent, id: string) => {
		e.dataTransfer.effectAllowed = "move"
		e.dataTransfer.setData("text/plain", id)
		rowDragRef.current = { dragId: id, overIndex: -1 }
	}, [])

	const onRowDragOver = useCallback((e: React.DragEvent, overIndex: number) => {
		e.preventDefault()
		e.dataTransfer.dropEffect = "move"
		if (rowDragRef.current) rowDragRef.current.overIndex = overIndex
	}, [])

	const onRowDrop = useCallback(
		(e: React.DragEvent, dropIndex: number) => {
			e.preventDefault()
			const dragId = e.dataTransfer.getData("text/plain")
			if (!dragId) return
			const currentOrder = layerOrder.length > 0 ? layerOrder : orderedLayers.map((l) => l.id)
			const fromIndex = currentOrder.indexOf(dragId)
			if (fromIndex === -1 || fromIndex === dropIndex) return
			const next = [...currentOrder]
			next.splice(fromIndex, 1)
			next.splice(dropIndex, 0, dragId)
			onReorder(next)
		},
		[layerOrder, orderedLayers, onReorder],
	)

	// ── file picker ───────────────────────────────────────────────────────
	const onPickFiles = () => fileInputRef.current?.click()

	const onFilesPicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
		const files = e.target.files
		if (!files || files.length === 0) return
		setLoadStatus({ kind: "idle", msg: `Loading…` })
		const result = await loadAndPushFiles(files)
		if (result.loaded > 0 && result.errors.length === 0)
			setLoadStatus({ kind: "ok", msg: `Loaded ${result.loaded} layer${result.loaded > 1 ? "s" : ""}.` })
		else if (result.loaded > 0)
			setLoadStatus({
				kind: "ok",
				msg: `Loaded ${result.loaded}, ${result.errors.length} error${result.errors.length > 1 ? "s" : ""}.`,
			})
		else setLoadStatus({ kind: "err", msg: result.errors[0] ?? "No files loaded." })
		if (fileInputRef.current) fileInputRef.current.value = ""
		window.setTimeout(() => setLoadStatus({ kind: "idle", msg: "" }), 5000)
	}

	return (
		<div
			style={{
				flex: 1,
				display: "flex",
				flexDirection: "column",
				overflow: "hidden",
				minHeight: 0,
				color: fg,
				fontFamily: "var(--vscode-font-family, system-ui, sans-serif)",
			}}>
			<input
				accept={ACCEPTED_EXTENSIONS}
				multiple
				onChange={onFilesPicked}
				ref={fileInputRef}
				style={{ display: "none" }}
				type="file"
			/>

			{/* "Show all details" toggle row — sits above the Add Layer bar */}
			<div
				style={{
					display: "flex",
					alignItems: "center",
					padding: "4px 8px",
					borderBottom: `1px solid ${border}`,
					background: subtle,
					gap: 4,
				}}>
				<span style={{ fontSize: 11, opacity: 0.7, flex: 1 }}>
					{layers.length === 0 ? "Empty" : `${layers.length} layer${layers.length === 1 ? "" : "s"}`}
				</span>
				{layers.length > 0 && (
					<>
						<IconBtn border={border} fg={fg} onClick={() => onShowAllLayers?.()} title="Show all layers">
							👁
						</IconBtn>
						<IconBtn border={border} fg={fg} onClick={() => onHideAllLayers?.()} title="Hide all layers">
							👁‍🗨
						</IconBtn>
					</>
				)}
				<IconBtn
					active={showDetails}
					border={border}
					fg={fg}
					onClick={() => setShowDetails((v) => !v)}
					title={showDetails ? "Hide all details" : "Show all details"}>
					ⓘ
				</IconBtn>
			</div>

			{/* Add Layer bar */}
			<div style={{ padding: "6px 8px", borderBottom: `1px solid ${border}` }}>
				<div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr", gap: 5 }}>
					<button
						onClick={onPickFiles}
						style={{
							padding: "6px 8px",
							fontSize: 12,
							fontWeight: 500,
							background: "var(--vscode-button-background, #0e639c)",
							color: "var(--vscode-button-foreground, #fff)",
							border: "none",
							borderRadius: 3,
							cursor: "pointer",
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							gap: 6,
						}}
						title="Add layer from file (GeoJSON, KML, KMZ, GPX, Shapefile.zip, GeoTIFF, CSV)"
						type="button">
						<span>＋</span>
						<span>Add file</span>
					</button>
					<button
						onClick={() => PLATFORM_CONFIG.postMessage({ type: "aihydro-map-add-url-command" })}
						style={smallBtn(fg, border)}
						title="Add layer from URL"
						type="button">
						🔗 URL
					</button>
					<button
						onClick={() => PLATFORM_CONFIG.postMessage({ type: "aihydro-map-gallery-command" })}
						style={smallBtn(fg, border)}
						title="Open AI-Hydro Map Gallery"
						type="button">
						🧪 Gallery
					</button>
				</div>
				<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5, marginTop: 5 }}>
					<button
						onClick={() => PLATFORM_CONFIG.postMessage({ type: "aihydro-map-save-scene-command" })}
						style={smallBtn(fg, border)}
						title="Save the current layer stack, styles, view, and source references"
						type="button">
						💾 Save scene
					</button>
					<button
						onClick={() => PLATFORM_CONFIG.postMessage({ type: "aihydro-map-open-scene-command" })}
						style={smallBtn(fg, border)}
						title="Open a saved AI-Hydro map scene"
						type="button">
						📂 Open scene
					</button>
				</div>
				{loadStatus.msg && (
					<div
						style={{
							marginTop: 4,
							fontSize: 11,
							color: loadStatus.kind === "err" ? danger : "var(--vscode-descriptionForeground, #999)",
						}}>
						{loadStatus.msg}
					</div>
				)}
			</div>

			{/* Layer list */}
			<div style={{ flex: 1, overflowY: "auto", padding: 6, minHeight: 0 }}>
				{orderedLayers.length === 0 ? (
					<div style={{ padding: 16, textAlign: "center", fontSize: 12, opacity: 0.75, lineHeight: 1.6 }}>
						<div style={{ fontSize: 32, marginBottom: 8 }}>🗺️</div>
						<div style={{ fontWeight: 600, marginBottom: 4 }}>No layers yet</div>
						<div>
							Click <strong>＋ Add Layer</strong> above,
							<br />
							or right-click a file in the
							<br />
							VS Code Explorer →
							<br />
							<strong>Add to AI-Hydro Map</strong>
						</div>
						<div style={{ fontSize: 10, marginTop: 10, opacity: 0.7 }}>
							GeoJSON · KML · KMZ · GPX
							<br />
							Shapefile (.zip) · GeoTIFF · CSV
						</div>
					</div>
				) : (
					orderedLayers.map((layer, idx) => {
						const isVisible = visibleLayerIds.has(layer.id)
						const swatch = colorSwatch(layer)
						const badge = sourceBadge(layer)
						const niceMeta = niceMetadata(layer)
						const expanded = expandedRows.has(layer.id)
						const detailsOn = allMetadata(layer).length > 0
						const editing = symbologyFor === layer.id
						const attrOpen = attrTableFor === layer.id
						const displayName = displayNames.get(layer.id) ?? layer.name ?? layer.id
						const isRaster = layer.layerType === "raster"
						const isGeeTile = layer.layerType === "gee_tile"
						const provenancePath = layer.metadata?.provenance_path
						const sourcePath =
							layer.metadata?.source_path || layer.metadata?.path || layer.metadata?.raster_source_path
						const sourceStatus = layer.metadata?.source_status
						const hasGeojson = !!layer.geojson && !isRaster
						const intelligence = deriveLayerIntelligence(layer, {
							rawRasterValuesAvailable: Boolean(rasterCache.get(layer.id)?.rawPixels),
						})
						const statusTone = statusColors(intelligence.dataState)
						const primaryWarning = intelligence.warnings[0]

						return (
							<div
								draggable
								key={layer.id}
								onDragOver={(e) => onRowDragOver(e, idx)}
								onDragStart={(e) => onRowDragStart(e, layer.id)}
								onDrop={(e) => onRowDrop(e, idx)}
								style={{
									padding: "6px 8px",
									marginBottom: 4,
									background: subtle,
									borderRadius: 4,
									border: `1px solid ${border}`,
									opacity: isVisible ? 1 : 0.55,
									cursor: "default",
								}}>
								{/* ── Row: visibility + swatch + icons + name ── */}
								<div style={{ display: "flex", alignItems: "center", gap: 4 }}>
									{/* Gripper */}
									<span
										style={{ fontSize: 13, opacity: 0.35, cursor: "grab", userSelect: "none", flexShrink: 0 }}
										title="Drag to reorder">
										⠿
									</span>

									{/* Visibility checkbox */}
									<input
										checked={isVisible}
										onChange={() => onVisibilityChange(layer.id, !isVisible)}
										style={{
											cursor: "pointer",
											accentColor: "var(--vscode-button-background)",
											flexShrink: 0,
										}}
										title={isVisible ? "Hide layer" : "Show layer"}
										type="checkbox"
									/>

									{/* Color swatch / symbology trigger */}
									<button
										onClick={() => setSymbologyFor(editing ? null : layer.id)}
										style={{
											width: isRaster ? 26 : 14,
											height: 14,
											padding: 0,
											borderRadius: 2,
											background: swatch,
											border: editing
												? "1px solid var(--vscode-focusBorder, #0e639c)"
												: "1px solid rgba(255,255,255,0.25)",
											flexShrink: 0,
											cursor: "pointer",
										}}
										title="Edit symbology"
										type="button"
									/>

									{/* Layer type + source badges */}
									<span style={{ fontSize: 10, opacity: 0.6, flexShrink: 0 }} title={layer.layerType ?? ""}>
										{layerTypeIcon(layer.layerType)}
									</span>
									<span style={{ fontSize: 11, flexShrink: 0 }} title={badge.title}>
										{badge.icon}
									</span>
									{isGeeTile && layer.metadata?.gee_mock === "true" && (
										<span
											style={{
												fontSize: 9,
												padding: "1px 5px",
												borderRadius: 3,
												background: "rgba(220,160,0,0.15)",
												color: "var(--vscode-editorWarning-foreground, #cca700)",
												flexShrink: 0,
											}}
											title="Mock tile layer">
											mock
										</span>
									)}
									{sourceStatus === "source_changed" && (
										<span
											style={{
												fontSize: 9,
												padding: "1px 5px",
												borderRadius: 3,
												background: "rgba(255, 190, 80, 0.14)",
												color: "var(--vscode-editorWarning-foreground, #cca700)",
												flexShrink: 0,
											}}
											title="The source file changed after this layer was loaded. Reload source to refresh it.">
											stale
										</span>
									)}
									<span
										style={{
											fontSize: 9,
											lineHeight: "15px",
											padding: "0 5px",
											borderRadius: 999,
											background: statusTone.bg,
											border: `1px solid ${statusTone.bd}`,
											color: statusTone.fg,
											flexShrink: 0,
											maxWidth: 112,
											overflow: "hidden",
											textOverflow: "ellipsis",
											whiteSpace: "nowrap",
										}}
										title={intelligence.statusDetail}>
										{intelligence.statusLabel}
									</span>
									{primaryWarning && (
										<span
											style={{
												fontSize: 11,
												color: "var(--vscode-editorWarning-foreground, #cca700)",
												flexShrink: 0,
											}}
											title={intelligence.warnings.map(warningText).join(" · ")}>
											⚠
										</span>
									)}

									{/* Name (double-click to rename) */}
									{renamingId === layer.id ? (
										<input
											autoFocus
											onBlur={() => void commitRename(layer)}
											onChange={(e) => setRenameDraft(e.target.value)}
											onKeyDown={(e) => {
												if (e.key === "Enter") {
													void commitRename(layer)
												}
												if (e.key === "Escape") {
													setRenamingId(null)
													setRenameDraft("")
												}
											}}
											style={{
												flex: 1,
												minWidth: 0,
												fontSize: 12,
												padding: "1px 4px",
												border: `1px solid var(--vscode-focusBorder, #0e639c)`,
												borderRadius: 2,
												background: "var(--vscode-input-background, #3c3c3c)",
												color: fg,
											}}
											title="Layer display name"
											type="text"
											value={renameDraft}
										/>
									) : (
										<span
											onDoubleClick={() => {
												setRenamingId(layer.id)
												setRenameDraft(displayName)
											}}
											style={{
												fontSize: 12,
												fontWeight: 500,
												flex: 1,
												overflow: "hidden",
												textOverflow: "ellipsis",
												whiteSpace: "nowrap",
												cursor: "text",
											}}
											title={`${displayName} — double-click to rename (saved in map session)`}>
											{displayName}
										</span>
									)}
								</div>

								{/* Opacity slider */}
								{isVisible && (
									<div
										style={{
											display: "flex",
											alignItems: "center",
											gap: 6,
											marginLeft: 50,
											marginTop: 4,
											marginBottom: 2,
										}}>
										<span style={{ fontSize: 10, opacity: 0.65, minWidth: 38 }}>Opacity</span>
										<input
											max={1}
											min={0}
											onChange={(e) => onOpacityChange?.(layer.id, parseFloat(e.target.value))}
											step={0.05}
											style={{
												flex: 1,
												accentColor: "var(--vscode-button-background)",
												cursor: "pointer",
											}}
											title={`Opacity: ${Math.round((layerOpacities[layer.id] ?? 1) * 100)}%`}
											type="range"
											value={
												layerOpacities[layer.id] ??
												(isRaster ? parseFloat(layer.metadata?.raster_opacity ?? "0.75") : 1)
											}
										/>
										<span
											style={{
												fontSize: 10,
												opacity: 0.65,
												minWidth: 28,
												textAlign: "right",
												fontVariantNumeric: "tabular-nums",
											}}>
											{Math.round(
												(layerOpacities[layer.id] ??
													(isRaster ? parseFloat(layer.metadata?.raster_opacity ?? "0.75") : 1)) * 100,
											)}
											%
										</span>
									</div>
								)}

								{/* ── Compact metadata line ── */}
								{niceMeta.length > 0 && (
									<div
										style={{
											fontSize: 10,
											opacity: 0.7,
											marginTop: 3,
											marginLeft: 58,
											display: "flex",
											flexWrap: "wrap",
											gap: "1px 6px",
										}}>
										{niceMeta.map(([k, v]) => (
											<span key={k}>
												<span style={{ opacity: 0.6 }}>{k}:</span> {v}
											</span>
										))}
									</div>
								)}

								{/* ── Icon toolbar ── */}
								<div style={{ display: "flex", gap: 3, marginTop: 5, marginLeft: 50, alignItems: "center" }}>
									<IconBtn
										border={border}
										fg={fg}
										onClick={() => onZoomToLayer?.(layer)}
										title="Zoom to extent">
										🔍
									</IconBtn>
									{provenancePath && (
										<IconBtn
											border={border}
											fg={fg}
											onClick={() => void openProvenance(provenancePath)}
											title="Open provenance record">
											📋
										</IconBtn>
									)}
									{sourcePath && (
										<IconBtn
											border={border}
											fg={fg}
											onClick={() => openSourceFile(sourcePath)}
											title="Open source file">
											↗
										</IconBtn>
									)}
									{sourcePath && (
										<IconBtn
											border={border}
											fg={fg}
											onClick={() => void handleReloadSource(layer, displayName)}
											title="Reload source file">
											⟳
										</IconBtn>
									)}
									<IconBtn
										active={editing}
										border={border}
										fg={fg}
										onClick={() => setSymbologyFor(editing ? null : layer.id)}
										title="Symbology">
										🎨
									</IconBtn>
									{/* Cluster toggle — only for point layers */}
									{!isRaster && hasGeojson && layer.layerType === "point" && (
										<IconBtn
											active={clusterLayerIds?.has(layer.id)}
											border={border}
											fg={fg}
											onClick={() => onClusterToggle?.(layer.id, !clusterLayerIds?.has(layer.id))}
											title={
												clusterLayerIds?.has(layer.id)
													? "Disable point clustering"
													: "Cluster points at low zoom"
											}>
											{clusterLayerIds?.has(layer.id) ? "🧩" : "🔘"}
										</IconBtn>
									)}
									{hasGeojson && (
										<IconBtn
											active={attrOpen}
											border={border}
											fg={fg}
											onClick={() => setAttrTableFor(attrOpen ? null : layer.id)}
											title="Attribute table">
											📊
										</IconBtn>
									)}
									{!isRaster && layer.metadata?.source !== "workspace" && (
										<IconBtn
											border={border}
											fg={fg}
											onClick={() => void handleSaveLayerToWorkspace(layer, displayName)}
											style={{ opacity: savingLayerId === layer.id ? 0.5 : 1 }}
											title="Save to workspace vectors">
											{savingLayerId === layer.id ? "…" : "📁"}
										</IconBtn>
									)}
									{!isRaster && layer.metadata?.source !== "workspace" && (
										<IconBtn
											border={border}
											fg={fg}
											onClick={() => exportLayer(layer, displayName)}
											title="Export as GeoJSON">
											💾
										</IconBtn>
									)}
									{detailsOn && (
										<IconBtn
											active={expanded}
											border={border}
											fg={fg}
											onClick={() => toggleRowDetails(layer.id)}
											title={expanded ? "Hide details" : "Show details"}>
											{expanded ? "▴" : "▾"}
										</IconBtn>
									)}
									{/* Move up / down */}
									<IconBtn
										border={border}
										fg={fg}
										onClick={() => {
											if (idx === 0) return
											const order = layerOrder.length > 0 ? layerOrder : orderedLayers.map((l) => l.id)
											const next = [...order]
											const i = next.indexOf(layer.id)
											if (i > 0) {
												;[next[i - 1], next[i]] = [next[i], next[i - 1]]
												onReorder(next)
											}
										}}
										style={{ opacity: idx === 0 ? 0.25 : 1 }}
										title="Move layer up (renders on top)">
										↑
									</IconBtn>
									<IconBtn
										border={border}
										fg={fg}
										onClick={() => {
											if (idx === orderedLayers.length - 1) return
											const order = layerOrder.length > 0 ? layerOrder : orderedLayers.map((l) => l.id)
											const next = [...order]
											const i = next.indexOf(layer.id)
											if (i < next.length - 1) {
												;[next[i], next[i + 1]] = [next[i + 1], next[i]]
												onReorder(next)
											}
										}}
										style={{ opacity: idx === orderedLayers.length - 1 ? 0.25 : 1 }}
										title="Move layer down (renders below)">
										↓
									</IconBtn>
									<div style={{ flex: 1 }} />
									<IconBtn
										border={border}
										fg={fg}
										onClick={() => handleRemove(layer.id)}
										style={{
											color: danger,
											borderColor: "rgba(220,53,69,0.35)",
											background: "rgba(220,53,69,0.08)",
										}}
										title="Remove layer">
										✕
									</IconBtn>
								</div>

								{/* ── Attribute table ── */}
								{attrOpen && hasGeojson && <AttributeTable border={border} fg={fg} layer={layer} />}

								{/* ── Symbology editor ── */}
								{editing && (
									<>
										{!isRaster && (
											<div
												style={{
													marginTop: 6,
													padding: 8,
													background: subtle,
													borderRadius: 4,
													display: "flex",
													gap: 6,
												}}>
												<button
													onClick={() => setSymbologyMode("basic")}
													style={{
														flex: 1,
														padding: "4px 8px",
														fontSize: 10,
														background:
															symbologyMode === "basic"
																? "var(--vscode-button-background, #0e639c)"
																: "transparent",
														color: fg,
														border: `1px solid ${border}`,
														borderRadius: 3,
														cursor: "pointer",
													}}
													type="button">
													Basic
												</button>
												<button
													onClick={() => setSymbologyMode("graduated")}
													style={{
														flex: 1,
														padding: "4px 8px",
														fontSize: 10,
														background:
															symbologyMode === "graduated"
																? "var(--vscode-button-background, #0e639c)"
																: "transparent",
														color: fg,
														border: `1px solid ${border}`,
														borderRadius: 3,
														cursor: "pointer",
													}}
													type="button">
													By Attribute
												</button>
											</div>
										)}
										{symbologyMode === "basic" ? (
											<SymbologyEditor
												layer={layer}
												mapStyle={mapStyle}
												onClose={() => setSymbologyFor(null)}
											/>
										) : (
											<GraduatedSymbologyEditor
												layer={layer}
												mapStyle={mapStyle}
												onClose={() => setSymbologyFor(null)}
											/>
										)}
									</>
								)}

								{(expanded || editing) && (
									<LayerInspector
										border={border}
										fg={fg}
										intelligence={intelligence}
										layer={layer}
										niceMeta={niceMeta}
									/>
								)}

								{/* ── Full metadata details ── */}
								{(expanded || showDetails) && detailsOn && (
									<div
										style={{
											marginTop: 8,
											paddingTop: 6,
											borderTop: `1px dashed ${border}`,
											fontSize: 10,
											fontFamily: "var(--vscode-editor-font-family, ui-monospace, monospace)",
											opacity: 0.85,
											display: "grid",
											gridTemplateColumns: "auto 1fr",
											gap: "2px 8px",
											wordBreak: "break-word",
										}}>
										{allMetadata(layer).map(([k, v]) => (
											<React.Fragment key={k}>
												<span style={{ opacity: 0.6 }}>{k}</span>
												<span>{v}</span>
											</React.Fragment>
										))}
									</div>
								)}
							</div>
						)
					})
				)}
			</div>

			{/* Footer — clear all */}
			{layers.length > 1 && (
				<div style={{ padding: 6, borderTop: `1px solid ${border}`, background: subtle }}>
					{confirmingClear ? (
						<div style={{ display: "flex", gap: 6, alignItems: "center" }}>
							<span style={{ fontSize: 11, flex: 1, color: danger }}>Remove all {layers.length}?</span>
							<button
								onClick={handleClearAll}
								style={{ ...smallBtn(fg, border), background: danger, color: "#fff", borderColor: danger }}
								type="button">
								Yes
							</button>
							<button onClick={() => setConfirmingClear(false)} style={smallBtn(fg, border)} type="button">
								No
							</button>
						</div>
					) : (
						<button
							onClick={() => setConfirmingClear(true)}
							style={{
								width: "100%",
								padding: "5px 8px",
								fontSize: 11,
								background: "rgba(220,53,69,0.08)",
								border: "1px solid rgba(220,53,69,0.28)",
								borderRadius: 3,
								color: danger,
								cursor: "pointer",
								fontWeight: 500,
							}}
							type="button">
							Clear all layers
						</button>
					)}
				</div>
			)}
		</div>
	)
}

// ─── Attribute Table ─────────────────────────────────────────────────────────

const AttributeTable: React.FC<{ layer: MapLayer; border: string; fg: string }> = ({ layer, border, fg }) => {
	const [page, setPage] = useState(0)
	const PAGE_SIZE = 10

	const { features, headers } = useMemo(() => {
		try {
			const parsed = JSON.parse(layer.geojson)
			const feats = parsed?.type === "FeatureCollection" ? parsed.features : parsed?.type === "Feature" ? [parsed] : []
			const keys = new Set<string>()
			for (const f of feats.slice(0, 100)) {
				for (const k of Object.keys(f.properties ?? {})) {
					if (!k.startsWith("_")) keys.add(k)
				}
			}
			return { features: feats, headers: Array.from(keys).slice(0, 12) }
		} catch {
			return { features: [], headers: [] }
		}
	}, [layer.geojson])

	const pageFeats = features.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
	const totalPages = Math.ceil(features.length / PAGE_SIZE)

	if (features.length === 0 || headers.length === 0) {
		return (
			<div
				style={{
					marginTop: 8,
					padding: "6px 8px",
					fontSize: 10,
					opacity: 0.65,
					borderTop: `1px dashed ${border}`,
					color: fg,
				}}>
				{features.length === 0 ? "No features in this layer." : "Features have no attribute columns."}
			</div>
		)
	}

	return (
		<div
			style={{
				marginTop: 8,
				overflow: "auto",
				maxHeight: 180,
				fontSize: 10,
				fontFamily: "var(--vscode-editor-font-family, ui-monospace, monospace)",
				borderTop: `1px dashed ${border}`,
			}}>
			<table style={{ width: "100%", borderCollapse: "collapse" }}>
				<thead>
					<tr style={{ background: "rgba(255,255,255,0.05)" }}>
						{headers.map((h) => (
							<th
								key={h}
								style={{
									padding: "2px 5px",
									textAlign: "left",
									opacity: 0.75,
									borderBottom: `1px solid ${border}`,
									whiteSpace: "nowrap",
								}}>
								{h}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{pageFeats.map((f: any, i: number) => (
						<tr key={i} style={{ borderBottom: `1px solid ${border}` }}>
							{headers.map((h) => (
								<td
									key={h}
									style={{
										padding: "2px 5px",
										maxWidth: 120,
										overflow: "hidden",
										textOverflow: "ellipsis",
										whiteSpace: "nowrap",
										color: fg,
									}}
									title={String(f.properties?.[h] ?? "")}>
									{String(f.properties?.[h] ?? "")}
								</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
			{totalPages > 1 && (
				<div style={{ display: "flex", gap: 6, justifyContent: "center", padding: 4, opacity: 0.7 }}>
					<button
						disabled={page === 0}
						onClick={() => setPage((p) => Math.max(0, p - 1))}
						style={{ fontSize: 10, cursor: "pointer", background: "transparent", border: "none", color: fg }}>
						‹ Prev
					</button>
					<span style={{ fontSize: 10 }}>
						{page + 1} / {totalPages} ({features.length} features)
					</span>
					<button
						disabled={page === totalPages - 1}
						onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
						style={{ fontSize: 10, cursor: "pointer", background: "transparent", border: "none", color: fg }}>
						Next ›
					</button>
				</div>
			)}
		</div>
	)
}

const LayerInspector: React.FC<{
	layer: MapLayer
	intelligence: LayerIntelligence
	niceMeta: Array<[string, string]>
	border: string
	fg: string
}> = ({ layer, intelligence, niceMeta, border, fg }) => {
	const [tab, setTab] = useState<"overview" | "data" | "provenance">("overview")
	const meta = layer.metadata ?? {}
	const all = allMetadata(layer)
	const statusTone = statusColors(intelligence.dataState)
	const rasterRange =
		meta.min || meta.max ? `${meta.min ?? "?"} – ${meta.max ?? "?"}${meta.units ? ` ${meta.units}` : ""}` : undefined
	const resolution = meta.resolution || meta.pixel_size || meta.cell_size || meta.raster_resolution

	return (
		<div
			style={{
				marginTop: 8,
				border: `1px solid ${border}`,
				borderRadius: 5,
				overflow: "hidden",
				background: "rgba(0,0,0,0.10)",
			}}>
			<div style={{ display: "flex", gap: 2, padding: 4, borderBottom: `1px solid ${border}` }}>
				{[
					["overview", "Overview"],
					["data", "Data"],
					["provenance", "Provenance"],
				].map(([key, label]) => (
					<button
						key={key}
						onClick={() => setTab(key as typeof tab)}
						style={{
							padding: "3px 8px",
							fontSize: 10,
							border: `1px solid ${tab === key ? statusTone.bd : "transparent"}`,
							borderRadius: 3,
							background: tab === key ? statusTone.bg : "transparent",
							color: fg,
							cursor: "pointer",
						}}
						type="button">
						{label}
					</button>
				))}
			</div>
			<div style={{ padding: 8, fontSize: 11, lineHeight: 1.45 }}>
				{tab === "overview" && (
					<>
						<div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
							<strong style={{ fontSize: 12 }}>{layer.name || layer.id}</strong>
							<span
								style={{
									fontSize: 9,
									padding: "1px 6px",
									borderRadius: 999,
									background: statusTone.bg,
									border: `1px solid ${statusTone.bd}`,
									color: statusTone.fg,
								}}>
								{intelligence.statusLabel}
							</span>
						</div>
						<div style={{ opacity: 0.78, marginBottom: 8 }}>{intelligence.statusDetail}</div>
						<InspectorGrid
							border={border}
							rows={[
								["Type", intelligence.typeLabel],
								["Source", intelligence.sourceLabel],
								...(rasterRange ? ([["Value range", rasterRange]] as Array<[string, string]>) : []),
								...(resolution ? ([["Resolution", resolution]] as Array<[string, string]>) : []),
								...niceMeta.slice(0, 5),
							]}
						/>
						{intelligence.warnings.length > 0 && (
							<div
								style={{
									marginTop: 8,
									padding: "5px 7px",
									borderRadius: 4,
									background: "rgba(255, 190, 80, 0.10)",
									color: "var(--vscode-editorWarning-foreground, #cca700)",
								}}>
								{intelligence.warnings.map(warningText).join(" · ")}
							</div>
						)}
					</>
				)}
				{tab === "data" && (
					<InspectorGrid
						border={border}
						rows={[
							["Capabilities", Array.from(intelligence.capabilities).join(", ")],
							["Layer state", intelligence.dataState.replace(/_/g, " ")],
							[
								"Feature/raster info",
								niceMeta.length > 0 ? niceMeta.map(([k, v]) => `${k}: ${v}`).join("; ") : "No summary available",
							],
						]}
					/>
				)}
				{tab === "provenance" && (
					<InspectorGrid
						border={border}
						rows={[
							["Source", intelligence.sourceLabel],
							[
								"Source status",
								meta.source_status === "source_changed" ? "Source changed — reload recommended" : "Current",
							],
							[
								"Source file",
								meta.source_display_path ?? meta.source_path ?? meta.path ?? "No local source path recorded",
							],
							["Source format", meta.source_format ?? meta.format ?? "Unknown"],
							["Converted artifact", meta.converted_artifact_path ?? "Not a converted vector layer"],
							["Provenance", intelligence.provenancePath ?? "No provenance record linked"],
							["Citation", intelligence.citation ?? meta.dataset ?? meta.gee_dataset_id ?? "No citation recorded"],
							["License", intelligence.license ?? "No license recorded"],
							["Path", meta.path ?? meta.raster_source_path ?? meta.raster_path ?? "No local source path recorded"],
							["Metadata fields", String(all.length)],
						]}
					/>
				)}
			</div>
		</div>
	)
}

const InspectorGrid: React.FC<{ rows: Array<[string, string]>; border: string }> = ({ rows, border }) => (
	<div
		style={{
			display: "grid",
			gridTemplateColumns: "minmax(78px, auto) 1fr",
			gap: "3px 8px",
			wordBreak: "break-word",
		}}>
		{rows
			.filter(([, value]) => value !== "")
			.map(([key, value]) => (
				<React.Fragment key={`${key}-${value}`}>
					<span style={{ opacity: 0.58 }}>{key}</span>
					<span style={{ borderBottom: `1px solid ${border}`, paddingBottom: 2 }}>{value}</span>
				</React.Fragment>
			))}
	</div>
)

// ─── Style helpers ───────────────────────────────────────────────────────────

const IconBtn: React.FC<{
	onClick: () => void
	title: string
	children: React.ReactNode
	fg: string
	border: string
	active?: boolean
	style?: React.CSSProperties
}> = ({ onClick, title, children, fg, border, active, style }) => (
	<button
		onClick={onClick}
		style={{
			background: active ? "rgba(255,255,255,0.12)" : "transparent",
			color: fg,
			border: `1px solid ${active ? border : "transparent"}`,
			borderRadius: 3,
			padding: "2px 5px",
			cursor: "pointer",
			fontSize: 12,
			lineHeight: 1,
			fontFamily: "inherit",
			...style,
		}}
		title={title}
		type="button">
		{children}
	</button>
)

const smallBtn = (fg: string, border: string): React.CSSProperties => ({
	padding: "3px 8px",
	fontSize: 11,
	background: "transparent",
	border: `1px solid ${border}`,
	borderRadius: 3,
	color: fg,
	cursor: "pointer",
	fontFamily: "inherit",
})

export default LayerPanelContent
