import type { MapLayer } from "@shared/proto/cline/map"
import React, { useEffect, useMemo, useRef, useState } from "react"
import { rasterCache } from "./formats/rasterCache"
import { addToMyGallery } from "./galleryStorage"
import { interpolateLine } from "./geoMeasureMath"
import { askAgentAboutBatchTransects, askAgentAboutTransect } from "./mapAgentBridge"
import { sampleAllRastersAtPoint, sampleTopRasterAtPoint } from "./mapLayerAdapters"
import { type ExportFormat, exportTransects, type ProfileDataMap, type ProfilePoint } from "./transectExport"
import {
	loadCollections,
	type MapTransect,
	newCollection,
	PRESET_TRANSECT_COLORS,
	saveCollections,
	saveTransects,
	type TransectCollection,
	type TransectPriority,
	type TransectStatus,
} from "./transectStorage"

// ─── Constants ──────────────────────────────────────────────────────────────

const PROFILE_SAMPLES = 200

const STATUS_OPTS: { value: TransectStatus; label: string; color: string }[] = [
	{ value: "open", label: "● Open", color: "#6b7280" },
	{ value: "in-progress", label: "◑ In Progress", color: "#f59e0b" },
	{ value: "reviewed", label: "◉ Reviewed", color: "#06b6d4" },
	{ value: "done", label: "✓ Done", color: "#22c55e" },
]

const PRIORITY_OPTS: { value: Exclude<TransectPriority, null>; label: string; color: string }[] = [
	{ value: "low", label: "▽ Low", color: "#6b7280" },
	{ value: "medium", label: "◈ Medium", color: "#f59e0b" },
	{ value: "high", label: "⚡ High", color: "#ef4444" },
]

// ─── Profile computation ──────────────────────────────────────────────────────

interface ProfileResult {
	data: (ProfilePoint & { lon: number; lat: number })[]
	sampledLayerName: string | null
	units?: string
}

/** Single-layer profile. If targetLayerId is set, pin to that layer; otherwise topmost visible. */
function computeProfile(
	transect: MapTransect,
	layers: MapLayer[],
	visibleLayerIds: Set<string>,
	layerOrder: string[],
	targetLayerId?: string | null,
): ProfileResult {
	const coords = transect.geometry.coordinates
	if (coords.length < 2) return { data: [], sampledLayerName: null }
	const points = coords.map((c) => ({ lon: c[0], lat: c[1] }))
	const samples = interpolateLine(points, PROFILE_SAMPLES)
	const data: (ProfilePoint & { lon: number; lat: number })[] = []
	let sampledLayerName: string | null = null
	let units: string | undefined

	// If a specific layer is pinned, sample only that one.
	const sampleLayers = targetLayerId ? layers.filter((l) => l.id === targetLayerId) : layers
	const sampleIds = targetLayerId ? new Set([targetLayerId]) : visibleLayerIds

	for (const pt of samples) {
		const reading = sampleTopRasterAtPoint(sampleLayers, sampleIds, layerOrder, pt.lon, pt.lat, rasterCache)
		if (reading && Number.isFinite(reading.value)) {
			data.push({ distKm: pt.distKm, value: reading.value, lon: pt.lon, lat: pt.lat })
			if (!sampledLayerName) {
				sampledLayerName = reading.layerName
				units = reading.units
			}
		}
	}
	return { data, sampledLayerName, units }
}

export interface LayerSeries {
	layerId: string
	layerName: string
	units?: string
	color: string
	data: (ProfilePoint & { lon: number; lat: number })[]
}

// Palette for multi-layer series (cycles)
const SERIES_COLORS = ["#f97316", "#06b6d4", "#22c55e", "#a855f7", "#ec4899", "#eab308"]

/** Sample all visible raster layers along a transect in one sweep. */
function computeMultiLayerProfiles(
	transect: MapTransect,
	layers: MapLayer[],
	visibleLayerIds: Set<string>,
	layerOrder: string[],
): LayerSeries[] {
	const coords = transect.geometry.coordinates
	if (coords.length < 2) return []
	const points = coords.map((c) => ({ lon: c[0], lat: c[1] }))
	const samples = interpolateLine(points, PROFILE_SAMPLES)

	// Map layerId → accumulated series data
	const seriesMap = new Map<string, LayerSeries>()

	for (const pt of samples) {
		const readings = sampleAllRastersAtPoint(layers, visibleLayerIds, layerOrder, pt.lon, pt.lat, rasterCache)
		for (const r of readings) {
			if (!seriesMap.has(r.layerId)) {
				seriesMap.set(r.layerId, {
					layerId: r.layerId,
					layerName: r.layerName,
					units: r.units,
					color: SERIES_COLORS[seriesMap.size % SERIES_COLORS.length],
					data: [],
				})
			}
			seriesMap.get(r.layerId)!.data.push({ distKm: pt.distKm, value: r.value, lon: pt.lon, lat: pt.lat })
		}
	}
	return Array.from(seriesMap.values())
}

export interface GeomorphicMetrics {
	reliefM: number
	hypsoIntegral: number // (mean - min) / (max - min)
	thalwegDistKm: number // dist of min value
	thalwegValue: number
	meanSlopePctPerKm: number // mean |dv/dx| * 100 / 1 (value change per km)
}

/** Derive geomorphic metrics from a profile. Works on any raster; most meaningful for DEMs. */
function computeGeomorphicMetrics(data: ProfilePoint[]): GeomorphicMetrics | null {
	if (data.length < 2) return null
	const values = data.map((d) => d.value)
	const min = Math.min(...values)
	const max = Math.max(...values)
	const mean = values.reduce((a, b) => a + b, 0) / values.length
	const range = max - min
	const thalwegIdx = values.indexOf(min)
	const totalLen = data[data.length - 1].distKm

	// Mean absolute gradient (value units / km)
	let slopeSum = 0
	for (let i = 1; i < data.length; i++) {
		const dv = Math.abs(values[i] - values[i - 1])
		const dd = data[i].distKm - data[i - 1].distKm
		if (dd > 0) slopeSum += dv / dd
	}
	return {
		reliefM: range,
		hypsoIntegral: range > 0 ? (mean - min) / range : 0.5,
		thalwegDistKm: data[thalwegIdx].distKm,
		thalwegValue: min,
		meanSlopePctPerKm: totalLen > 0 ? slopeSum / (data.length - 1) : 0,
	}
}

function csvCell(v: string | number): string {
	const s = String(v ?? "")
	return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Sample every transect and build a CSV table with profile statistics for batch analysis. */
function buildBatchCsv(targets: MapTransect[], layers: MapLayer[], visibleLayerIds: Set<string>, layerOrder: string[]): string {
	const header = [
		"name",
		"status",
		"priority",
		"tags",
		"sampled_layer",
		"length_km",
		"min",
		"max",
		"mean",
		"samples",
		"start_lon",
		"start_lat",
		"end_lon",
		"end_lat",
		"notes",
	]
	const rows = targets.map((t) => {
		const { data, sampledLayerName } = computeProfile(t, layers, visibleLayerIds, layerOrder, t.targetRasterId)
		const coords = t.geometry.coordinates
		const start = coords[0] ?? [NaN, NaN]
		const end = coords[coords.length - 1] ?? [NaN, NaN]
		const values = data.map((d) => d.value)
		const hasData = values.length > 0
		return [
			t.name,
			t.status,
			t.priority ?? "",
			t.tags.join("; "),
			sampledLayerName ?? "",
			hasData ? data[data.length - 1].distKm.toFixed(3) : "",
			hasData ? Math.min(...values).toFixed(3) : "",
			hasData ? Math.max(...values).toFixed(3) : "",
			hasData ? (values.reduce((a, b) => a + b, 0) / values.length).toFixed(3) : "",
			values.length,
			start[0],
			start[1],
			end[0],
			end[1],
			t.notes,
		]
			.map(csvCell)
			.join(",")
	})
	return [header.join(","), ...rows].join("\n")
}

// ─── Props ──────────────────────────────────────────────────────────────────

interface TransectsPanelProps {
	transects: MapTransect[]
	setTransects: React.Dispatch<React.SetStateAction<MapTransect[]>>
	onFlyTo: (lon: number, lat: number) => void
	onStartDrawing: () => void
	mapStyle: "light" | "dark"
	layers: MapLayer[]
	visibleLayerIds: Set<string>
	layerOrder: string[]
	/** Bumped by MapView after a raster preload so profiles recompute. */
	rasterReadyTick?: number
	/** When set, expand the card with this id (driven by map line click). */
	requestExpandId?: string | null
	/** Called with the hovered profile point's lon/lat (or null on leave) for map marker. */
	onProfileHover?: (coord: { lon: number; lat: number } | null) => void
	/** Called after saving to My Gallery so the parent can sync React state. */
	onSaveToGallery?: (item: import("./galleryStorage").MyGalleryItem) => void
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function TransectsPanel({
	transects,
	setTransects,
	onFlyTo,
	onStartDrawing,
	mapStyle,
	layers,
	visibleLayerIds,
	layerOrder,
	rasterReadyTick = 0,
	requestExpandId,
	onProfileHover,
	onSaveToGallery,
}: TransectsPanelProps) {
	const isDark = mapStyle === "dark"
	const fg = isDark ? "var(--vscode-foreground, #ddd)" : "var(--vscode-foreground, #222)"
	const border = isDark ? "rgba(255,255,255,0.13)" : "rgba(0,0,0,0.13)"
	const subtle = isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)"
	const subtleBorder = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)"
	const accent = "#6366f1"
	const inputStyle: React.CSSProperties = {
		fontSize: 11,
		padding: "4px 7px",
		background: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)",
		color: fg,
		border: `1px solid ${border}`,
		borderRadius: 4,
		fontFamily: "inherit",
		width: "100%",
		boxSizing: "border-box",
	}

	const [collections, setCollections] = useState<TransectCollection[]>(() => loadCollections())
	const [activeCollectionId, setActiveCollectionId] = useState<string>("all")
	const [editingCollectionId, setEditingCollectionId] = useState<string | null>(null)
	const [search, setSearch] = useState("")
	const [filterStatus, setFilterStatus] = useState<TransectStatus | "all">("all")
	const [expandedId, setExpandedId] = useState<string | null>(null)
	const [agentBusy, setAgentBusy] = useState<string | false>(false)
	const [agentError, setAgentError] = useState<string | null>(null)
	const [batchOpen, setBatchOpen] = useState(false)
	const [batchInstruction, setBatchInstruction] = useState("")
	const [showExportMenu, setShowExportMenu] = useState(false)
	const exportBtnRef = useRef<HTMLDivElement>(null)
	const [gallerySaveOpen, setGallerySaveOpen] = useState(false)
	const [galleryTitle, setGalleryTitle] = useState("")
	const [galleryDesc, setGalleryDesc] = useState("")
	const [galleryTagsRaw, setGalleryTagsRaw] = useState("")

	// Expand the card when the user clicks its line on the map.
	useEffect(() => {
		if (requestExpandId) {
			setExpandedId(requestExpandId)
		}
	}, [requestExpandId])

	const saveTrans = (next: MapTransect[]) => {
		setTransects(next)
		saveTransects(next)
	}

	const saveCols = (next: TransectCollection[]) => {
		setCollections(next)
		saveCollections(next)
	}

	const updateTransect = (id: string, patch: Partial<MapTransect>) => {
		setTransects((prev) => {
			const next = prev.map((t) => (t.id === id ? { ...t, ...patch, updatedAt: new Date().toISOString() } : t))
			saveTransects(next)
			return next
		})
	}

	const deleteTransect = (id: string) => {
		setTransects((prev) => {
			const next = prev.filter((t) => t.id !== id)
			saveTransects(next)
			return next
		})
		if (expandedId === id) setExpandedId(null)
	}

	const duplicateTransect = (t: MapTransect) => {
		const now = new Date().toISOString()
		const copy: MapTransect = {
			...t,
			id: `transect_${Date.now()}`,
			name: `${t.name} (copy)`,
			createdAt: now,
			updatedAt: now,
		}
		saveTrans([...transects, copy])
	}

	const filtered = useMemo(() => {
		return transects.filter((t) => {
			if (filterStatus !== "all" && t.status !== filterStatus) return false
			if (activeCollectionId !== "all" && !t.collectionIds.includes(activeCollectionId)) return false
			if (search) {
				const q = search.toLowerCase()
				return (
					t.name.toLowerCase().includes(q) ||
					t.notes.toLowerCase().includes(q) ||
					t.tags.some((tag) => tag.toLowerCase().includes(q))
				)
			}
			return true
		})
	}, [transects, filterStatus, activeCollectionId, search])

	// Per-transect UI state for layer picker and overlay mode
	const [overlayMode, setOverlayMode] = useState<Record<string, boolean>>({})
	const visibleRasterLayers = useMemo(
		() => layers.filter((l) => visibleLayerIds.has(l.id) && (l.layerType === "raster" || l.layerType === "gee_tile")),
		[layers, visibleLayerIds],
	)

	// Compute the expanded transect's profile (memoized; recomputes when geometry,
	// visible layers, or the raster cache changes).
	const expandedTransect = transects.find((t) => t.id === expandedId) ?? null
	const visibleKey = useMemo(() => Array.from(visibleLayerIds).sort().join("|"), [visibleLayerIds])
	const isOverlay = expandedId ? (overlayMode[expandedId] ?? false) : false

	const expandedProfile = useMemo<ProfileResult>(() => {
		if (!expandedTransect || isOverlay) return { data: [], sampledLayerName: null }
		return computeProfile(expandedTransect, layers, visibleLayerIds, layerOrder, expandedTransect.targetRasterId)
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [
		expandedTransect?.id,
		expandedTransect?.updatedAt,
		expandedTransect?.targetRasterId,
		layers,
		visibleKey,
		layerOrder,
		rasterReadyTick,
		isOverlay,
	])

	const expandedMultiProfiles = useMemo<LayerSeries[]>(() => {
		if (!expandedTransect || !isOverlay) return []
		return computeMultiLayerProfiles(expandedTransect, layers, visibleLayerIds, layerOrder)
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [expandedTransect?.id, expandedTransect?.updatedAt, layers, visibleKey, layerOrder, rasterReadyTick, isOverlay])

	// Use expanded single profile (or first series) for metrics + agent
	const activeProfileData = isOverlay ? (expandedMultiProfiles[0]?.data ?? []) : expandedProfile.data
	const expandedMetrics = useMemo(
		() => computeGeomorphicMetrics(activeProfileData),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[activeProfileData.length, activeProfileData[0]?.distKm],
	)

	const handleAskAgent = async (t: MapTransect, profileData: (ProfilePoint & { lon: number; lat: number })[]) => {
		if (agentBusy) return
		setAgentBusy(t.id)
		setAgentError(null)
		try {
			const visibleLayers = layers.filter((l) => visibleLayerIds.has(l.id))
			const result = await askAgentAboutTransect({
				transect: t,
				profileData: profileData.map((p) => ({ distKm: p.distKm, value: p.value })),
				visibleLayers,
			})
			if (!result.ok) {
				setAgentError(result.error || "Agent task failed. Is the AI-Hydro chat panel open?")
			}
		} catch (e) {
			setAgentError(e instanceof Error ? e.message : "Unknown error")
		} finally {
			setAgentBusy(false)
		}
	}

	const handleBatchAskAgent = async () => {
		const target = activeCollectionId !== "all" ? filtered : transects
		if (target.length === 0 || agentBusy) return
		setAgentBusy("batch")
		setAgentError(null)
		try {
			const csvTable = buildBatchCsv(target, layers, visibleLayerIds, layerOrder)
			const col = collections.find((c) => c.id === activeCollectionId)
			const result = await askAgentAboutBatchTransects({
				csvTable,
				userInstruction:
					batchInstruction ||
					(col ? `Analyze the transects in the "${col.name}" collection. ${col.description}`.trim() : undefined),
				visibleLayers: layers.filter((l) => visibleLayerIds.has(l.id)),
			})
			if (result.ok) {
				setBatchOpen(false)
				setBatchInstruction("")
			} else {
				setAgentError(result.error || "Batch agent task failed. Is the AI-Hydro chat panel open?")
			}
		} catch (e) {
			setAgentError(e instanceof Error ? e.message : "Unknown error")
		} finally {
			setAgentBusy(false)
		}
	}

	const handleExport = async (format: ExportFormat) => {
		setShowExportMenu(false)
		const target = filtered.length > 0 ? filtered : transects
		// For profile_pts we need full coordinates; otherwise stats suffice.
		const profiles: ProfileDataMap = {}
		if (expandedTransect && activeProfileData.length > 0) {
			profiles[expandedTransect.id] = activeProfileData
		}
		const col = collections.find((c) => c.id === activeCollectionId)
		await exportTransects(format, target, profiles, col)
	}

	const handleNewCollection = () => {
		const col = newCollection(collections.length)
		saveCols([...collections, col])
		setEditingCollectionId(col.id)
		setActiveCollectionId(col.id)
	}

	const handleDeleteCollection = (id: string) => {
		saveCols(collections.filter((c) => c.id !== id))
		if (activeCollectionId === id) setActiveCollectionId("all")
	}

	const sectionBorder = `1px solid ${border}`

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 8, color: fg }}>
			{/* Toolbar */}
			<div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
				<span style={{ fontSize: 11, fontWeight: 700, flex: 1, opacity: 0.9, whiteSpace: "nowrap" }}>📈 Transects</span>
				<button
					onClick={() => {
						setAgentError(null)
						onStartDrawing()
					}}
					style={{
						fontSize: 10,
						padding: "2px 8px",
						background: accent,
						color: "#fff",
						border: "none",
						borderRadius: 4,
						cursor: "pointer",
						fontWeight: 600,
					}}
					title="Draw a cross-sectional profile line"
					type="button">
					＋ Draw Profile
				</button>
				<div ref={exportBtnRef} style={{ position: "relative" }}>
					<button
						disabled={transects.length === 0}
						onClick={() => setShowExportMenu((v) => !v)}
						style={{
							fontSize: 10,
							padding: "2px 7px",
							background: "transparent",
							color: fg,
							border: `1px solid ${border}`,
							borderRadius: 4,
							cursor: transects.length > 0 ? "pointer" : "default",
							opacity: transects.length > 0 ? 1 : 0.4,
						}}
						title="Export transects"
						type="button">
						⬇ Export ▾
					</button>
					{showExportMenu && (
						<div
							style={{
								position: "absolute",
								right: 0,
								top: "calc(100% + 4px)",
								zIndex: 200,
								background: isDark ? "#1e1e2e" : "#fff",
								border: sectionBorder,
								borderRadius: 6,
								padding: "4px 0",
								minWidth: 150,
								boxShadow: "0 4px 16px rgba(0,0,0,0.35)",
							}}>
							{(["csv", "geojson", "kml", "md", "profile_pts"] as ExportFormat[]).map((fmt) => (
								<button
									key={fmt}
									onClick={() => handleExport(fmt)}
									style={{
										display: "block",
										width: "100%",
										padding: "5px 12px",
										fontSize: 10,
										background: "none",
										color: fg,
										border: "none",
										textAlign: "left",
										cursor: "pointer",
										whiteSpace: "nowrap",
									}}
									type="button">
									{fmt === "csv"
										? "📊 CSV (summary)"
										: fmt === "geojson"
											? "🌐 GeoJSON"
											: fmt === "kml"
												? "🌍 KML"
												: fmt === "md"
													? "📝 Markdown Report"
													: "📈 Profile Points CSV"}
								</button>
							))}
						</div>
					)}
				</div>
			</div>

			{/* Collections tabs */}
			<div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
				<button
					onClick={() => setActiveCollectionId("all")}
					style={{
						fontSize: 9,
						padding: "2px 8px",
						borderRadius: 12,
						border: `1px solid ${activeCollectionId === "all" ? accent : border}`,
						background: activeCollectionId === "all" ? `${accent}22` : "transparent",
						color: activeCollectionId === "all" ? "#a5b4fc" : fg,
						cursor: "pointer",
						fontWeight: activeCollectionId === "all" ? 700 : 400,
					}}
					type="button">
					All ({transects.length})
				</button>
				{collections.map((col) => {
					const count = transects.filter((t) => t.collectionIds.includes(col.id)).length
					const isActive = activeCollectionId === col.id
					return editingCollectionId === col.id ? (
						<input
							autoFocus
							key={col.id}
							onBlur={() => setEditingCollectionId(null)}
							onChange={(e) =>
								saveCols(collections.map((c) => (c.id === col.id ? { ...c, name: e.target.value } : c)))
							}
							onKeyDown={(e) => {
								if (e.key === "Enter") setEditingCollectionId(null)
							}}
							style={{ ...inputStyle, width: 90, padding: "1px 6px", fontSize: 9 }}
							value={col.name}
						/>
					) : (
						<div key={col.id} style={{ display: "flex", alignItems: "center" }}>
							<button
								onClick={() => setActiveCollectionId(col.id)}
								style={{
									fontSize: 9,
									padding: "2px 8px",
									borderRadius: "12px 0 0 12px",
									border: `1px solid ${isActive ? col.color : border}`,
									background: isActive ? `${col.color}22` : "transparent",
									color: isActive ? col.color : fg,
									cursor: "pointer",
									fontWeight: isActive ? 700 : 400,
								}}
								type="button">
								<span
									style={{
										display: "inline-block",
										width: 7,
										height: 7,
										borderRadius: "50%",
										background: col.color,
										marginRight: 4,
										verticalAlign: "middle",
									}}
								/>
								{col.name} ({count})
							</button>
							<button
								onClick={() => setEditingCollectionId(col.id)}
								style={{
									fontSize: 8,
									padding: "2px 4px",
									border: `1px solid ${isActive ? col.color : border}`,
									borderLeft: "none",
									background: "transparent",
									color: fg,
									cursor: "pointer",
									opacity: 0.5,
								}}
								title="Rename collection"
								type="button">
								✏
							</button>
							<button
								onClick={() => handleDeleteCollection(col.id)}
								style={{
									fontSize: 8,
									padding: "2px 4px",
									borderRadius: "0 12px 12px 0",
									border: `1px solid ${isActive ? col.color : border}`,
									borderLeft: "none",
									background: "transparent",
									color: "#ef4444",
									cursor: "pointer",
									opacity: 0.6,
								}}
								title="Delete collection"
								type="button">
								✕
							</button>
						</div>
					)
				})}
				<button
					onClick={handleNewCollection}
					style={{
						fontSize: 9,
						padding: "2px 7px",
						borderRadius: 12,
						border: `1px dashed ${border}`,
						background: "transparent",
						color: fg,
						cursor: "pointer",
						opacity: 0.6,
					}}
					type="button">
					+ Collection
				</button>
			</div>

			{/* Search + status filter */}
			<div style={{ display: "flex", gap: 4, alignItems: "center" }}>
				<input
					onChange={(e) => setSearch(e.target.value)}
					placeholder="Search name, notes, tags…"
					style={{ ...inputStyle, flex: 1 }}
					value={search}
				/>
				<select
					onChange={(e) => setFilterStatus(e.target.value as TransectStatus | "all")}
					style={{ ...inputStyle, width: "auto", cursor: "pointer" }}
					value={filterStatus}>
					<option value="all">All status</option>
					{STATUS_OPTS.map((s) => (
						<option key={s.value} value={s.value}>
							{s.label}
						</option>
					))}
				</select>
			</div>

			{/* Error banner */}
			{agentError && (
				<div
					style={{
						padding: "5px 8px",
						background: "rgba(239,68,68,0.1)",
						border: "1px solid rgba(239,68,68,0.3)",
						borderRadius: 4,
						fontSize: 10,
						color: "#f87171",
						display: "flex",
						alignItems: "center",
						gap: 6,
					}}>
					<span style={{ flex: 1 }}>⚠ {agentError}</span>
					<button
						onClick={() => setAgentError(null)}
						style={{
							background: "none",
							border: "none",
							color: "#f87171",
							cursor: "pointer",
							fontSize: 12,
							padding: 0,
						}}
						type="button">
						✕
					</button>
				</div>
			)}

			{/* Batch composer */}
			{batchOpen && (
				<div
					style={{
						padding: 10,
						background: isDark ? "rgba(99,102,241,0.07)" : "rgba(99,102,241,0.04)",
						border: "1px solid rgba(99,102,241,0.3)",
						borderRadius: 6,
					}}>
					<div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
						<span style={{ fontSize: 11, fontWeight: 700, color: "#a5b4fc", flex: 1 }}>
							✨ Batch Profile Analysis
						</span>
						<span style={{ fontSize: 9, opacity: 0.6 }}>
							{(activeCollectionId !== "all" ? filtered : transects).length} transect
							{(activeCollectionId !== "all" ? filtered : transects).length !== 1 ? "s" : ""}
						</span>
					</div>
					<div style={{ fontSize: 10, opacity: 0.65, lineHeight: 1.5, marginBottom: 6 }}>
						Each transect is sampled along the topmost visible raster and sent as a CSV table of profile statistics
						(min/max/mean/length). Add batch-level instructions below (optional).
					</div>
					<textarea
						onChange={(e) => setBatchInstruction(e.target.value)}
						placeholder="E.g. Rank these cross-sections by channel incision and flag any that cross a floodplain…"
						rows={3}
						style={{ ...inputStyle, resize: "vertical" }}
						value={batchInstruction}
					/>
					<div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 8 }}>
						<button
							onClick={() => {
								setBatchOpen(false)
								setAgentError(null)
							}}
							style={{
								fontSize: 10,
								padding: "4px 10px",
								background: "transparent",
								color: fg,
								border: `1px solid ${border}`,
								borderRadius: 4,
								cursor: "pointer",
							}}
							type="button">
							Cancel
						</button>
						<button
							disabled={Boolean(agentBusy)}
							onClick={handleBatchAskAgent}
							style={{
								fontSize: 10,
								padding: "4px 14px",
								background: agentBusy ? "rgba(99,102,241,0.4)" : "rgba(99,102,241,0.85)",
								color: "#fff",
								border: "none",
								borderRadius: 4,
								cursor: agentBusy ? "wait" : "pointer",
								fontWeight: 600,
							}}
							type="button">
							{agentBusy === "batch" ? "⏳ Sampling & sending…" : "✨ Send to Agent"}
						</button>
					</div>
				</div>
			)}

			{/* Cards */}
			{filtered.length === 0 ? (
				<div style={{ fontSize: 10, opacity: 0.5, fontStyle: "italic", padding: "8px 0" }}>
					{transects.length === 0
						? "No transects yet — click ＋ Draw Profile to add one."
						: "No transects match your filter."}
				</div>
			) : (
				<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
					{filtered.map((t) => {
						const isExpanded = expandedId === t.id
						const isBusy = agentBusy === t.id
						const tIsOverlay = isExpanded ? isOverlay : false
						return (
							<div
								key={t.id}
								style={{
									borderRadius: 5,
									border: `1px solid ${border}`,
									borderLeft: `3px solid ${t.color}`,
									overflow: "hidden",
								}}>
								{/* Header */}
								<div
									onClick={() => setExpandedId(isExpanded ? null : t.id)}
									style={{
										padding: "7px 9px",
										background: subtle,
										cursor: "pointer",
										display: "flex",
										alignItems: "center",
										gap: 6,
									}}>
									<span style={{ fontSize: 12 }}>📈</span>
									<span
										style={{
											fontSize: 11,
											fontWeight: 600,
											flex: 1,
											overflow: "hidden",
											textOverflow: "ellipsis",
											whiteSpace: "nowrap",
										}}>
										{t.name}
									</span>
									<PriorityBadge priority={t.priority} />
									<StatusBadge status={t.status} />
									<span style={{ fontSize: 10, opacity: 0.5, marginLeft: 2 }}>{isExpanded ? "▲" : "▼"}</span>
								</div>

								{/* Expanded body */}
								{isExpanded && (
									<div style={{ padding: "10px 10px 8px", display: "flex", flexDirection: "column", gap: 10 }}>
										{/* Layer picker + overlay toggle */}
										<div style={{ display: "flex", gap: 6, alignItems: "center" }}>
											{!tIsOverlay && visibleRasterLayers.length > 0 && (
												<>
													<FieldLabel style={{ margin: 0, whiteSpace: "nowrap" }}>
														Sample from
													</FieldLabel>
													<select
														onChange={(e) =>
															updateTransect(t.id, { targetRasterId: e.target.value || undefined })
														}
														style={{ ...inputStyle, flex: 1, margin: 0 }}
														value={t.targetRasterId ?? ""}>
														<option value="">Topmost visible</option>
														{visibleRasterLayers.map((l) => (
															<option key={l.id} value={l.id}>
																{l.name}
															</option>
														))}
													</select>
												</>
											)}
											{visibleRasterLayers.length > 1 && (
												<button
													onClick={() => setOverlayMode((prev) => ({ ...prev, [t.id]: !prev[t.id] }))}
													style={{
														fontSize: 9,
														padding: "2px 7px",
														whiteSpace: "nowrap",
														borderRadius: 4,
														border: `1px solid ${tIsOverlay ? "#06b6d4" : border}`,
														background: tIsOverlay ? "rgba(6,182,212,0.15)" : "transparent",
														color: tIsOverlay ? "#06b6d4" : fg,
														cursor: "pointer",
														fontWeight: tIsOverlay ? 700 : 400,
													}}
													title={
														tIsOverlay
															? "Show single-layer profile"
															: "Compare all visible raster layers"
													}
													type="button">
													{tIsOverlay ? "⊞ Overlay ON" : "⊞ Compare layers"}
												</button>
											)}
										</div>

										{/* Chart */}
										{tIsOverlay ? (
											<MultiSeriesChart
												isDark={isDark}
												onHover={onProfileHover}
												series={expandedMultiProfiles}
											/>
										) : (
											<ProfileChart
												color={t.color}
												isDark={isDark}
												onHover={onProfileHover}
												profile={expandedProfile}
											/>
										)}

										{/* Geomorphic metrics chips */}
										{expandedMetrics && activeProfileData.length > 0 && (
											<div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
												<MetricChip label="Relief" value={expandedMetrics.reliefM.toFixed(2)} />
												<MetricChip
													label="Thalweg"
													value={`${expandedMetrics.thalwegDistKm.toFixed(2)} km`}
												/>
												<MetricChip
													label="Hypsometric I."
													value={expandedMetrics.hypsoIntegral.toFixed(3)}
												/>
												<MetricChip
													label="Mean gradient"
													value={`${expandedMetrics.meanSlopePctPerKm.toFixed(2)}/km`}
												/>
											</div>
										)}

										{/* Name */}
										<div>
											<FieldLabel>Name</FieldLabel>
											<input
												onChange={(e) => updateTransect(t.id, { name: e.target.value })}
												style={inputStyle}
												value={t.name}
											/>
										</div>

										{/* Notes */}
										<div>
											<FieldLabel>📓 My Notes</FieldLabel>
											<textarea
												onChange={(e) => updateTransect(t.id, { notes: e.target.value })}
												placeholder="Field observations, channel context, what to look for…"
												rows={2}
												style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }}
												value={t.notes}
											/>
										</div>

										{/* AI Prompt */}
										<div>
											<FieldLabel>
												🤖 AI Prompt{" "}
												<span
													style={{ fontWeight: 400, textTransform: "none", fontSize: 9, opacity: 0.7 }}>
													(optional — overrides smart default)
												</span>
											</FieldLabel>
											<textarea
												onChange={(e) => updateTransect(t.id, { aiPrompt: e.target.value })}
												placeholder="e.g. Identify the channel thalweg and estimate bankfull width from this profile"
												rows={2}
												style={{
													...inputStyle,
													resize: "vertical",
													lineHeight: 1.5,
													borderColor: t.aiPrompt ? "rgba(99,102,241,0.5)" : undefined,
												}}
												value={t.aiPrompt}
											/>
										</div>

										{/* Tags */}
										<div>
											<FieldLabel>Tags</FieldLabel>
											<div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
												{t.tags.map((tag) => (
													<span
														key={tag}
														style={{
															fontSize: 9,
															padding: "2px 7px",
															borderRadius: 10,
															background: "rgba(99,102,241,0.15)",
															color: "#a5b4fc",
															display: "flex",
															alignItems: "center",
															gap: 3,
														}}>
														#{tag}
														<button
															onClick={() =>
																updateTransect(t.id, { tags: t.tags.filter((x) => x !== tag) })
															}
															style={{
																background: "none",
																border: "none",
																color: "#a5b4fc",
																cursor: "pointer",
																fontSize: 9,
																padding: 0,
																lineHeight: 1,
															}}
															type="button">
															×
														</button>
													</span>
												))}
												<input
													onKeyDown={(e) => {
														if (e.key === "Enter" || e.key === ",") {
															const v = (e.target as HTMLInputElement).value
																.trim()
																.replace(/,/g, "")
															if (v && !t.tags.includes(v))
																updateTransect(t.id, { tags: [...t.tags, v] })
															;(e.target as HTMLInputElement).value = ""
															e.preventDefault()
														}
													}}
													placeholder="+ tag"
													style={{ ...inputStyle, width: 60, padding: "2px 6px", fontSize: 9 }}
												/>
											</div>
										</div>

										{/* Status + Priority */}
										<div style={{ display: "flex", gap: 8 }}>
											<div style={{ flex: 1 }}>
												<FieldLabel>Status</FieldLabel>
												<select
													onChange={(e) =>
														updateTransect(t.id, { status: e.target.value as TransectStatus })
													}
													style={inputStyle}
													value={t.status}>
													{STATUS_OPTS.map((s) => (
														<option key={s.value} value={s.value}>
															{s.label}
														</option>
													))}
												</select>
											</div>
											<div style={{ flex: 1 }}>
												<FieldLabel>Priority</FieldLabel>
												<select
													onChange={(e) =>
														updateTransect(t.id, {
															priority: (e.target.value || null) as TransectPriority,
														})
													}
													style={inputStyle}
													value={t.priority ?? ""}>
													<option value="">— None —</option>
													{PRIORITY_OPTS.map((p) => (
														<option key={p.value} value={p.value}>
															{p.label}
														</option>
													))}
												</select>
											</div>
										</div>

										{/* Collections */}
										{collections.length > 0 && (
											<div>
												<FieldLabel>Collections</FieldLabel>
												<div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
													{collections.map((col) => {
														const inCol = t.collectionIds.includes(col.id)
														return (
															<button
																key={col.id}
																onClick={() =>
																	updateTransect(t.id, {
																		collectionIds: inCol
																			? t.collectionIds.filter((id) => id !== col.id)
																			: [...t.collectionIds, col.id],
																	})
																}
																style={{
																	fontSize: 9,
																	padding: "2px 8px",
																	borderRadius: 10,
																	border: `1px solid ${inCol ? col.color : border}`,
																	background: inCol ? `${col.color}22` : "transparent",
																	color: inCol ? col.color : fg,
																	cursor: "pointer",
																	fontWeight: inCol ? 700 : 400,
																}}
																type="button">
																<span
																	style={{
																		display: "inline-block",
																		width: 6,
																		height: 6,
																		borderRadius: "50%",
																		background: col.color,
																		marginRight: 4,
																		verticalAlign: "middle",
																	}}
																/>
																{col.name}
															</button>
														)
													})}
												</div>
											</div>
										)}

										{/* Colour */}
										<div>
											<FieldLabel>Colour</FieldLabel>
											<div style={{ display: "flex", gap: 5 }}>
												{PRESET_TRANSECT_COLORS.map((c) => (
													<button
														key={c}
														onClick={() => updateTransect(t.id, { color: c })}
														style={{
															width: 16,
															height: 16,
															borderRadius: "50%",
															background: c,
															border:
																t.color === c ? `2px solid ${fg}` : "1px solid rgba(0,0,0,0.25)",
															cursor: "pointer",
															padding: 0,
															flexShrink: 0,
														}}
														type="button"
													/>
												))}
											</div>
										</div>

										{/* Actions */}
										<div
											style={{
												display: "flex",
												gap: 6,
												flexWrap: "wrap",
												paddingTop: 6,
												borderTop: `1px solid ${subtleBorder}`,
												alignItems: "center",
											}}>
											<button
												onClick={() =>
													onFlyTo(t.geometry.coordinates[0][0], t.geometry.coordinates[0][1])
												}
												style={{
													fontSize: 10,
													padding: "3px 8px",
													background: "transparent",
													color: fg,
													border: `1px solid ${border}`,
													borderRadius: 4,
													cursor: "pointer",
												}}
												type="button">
												📍 Fly to
											</button>
											<button
												onClick={() => duplicateTransect(t)}
												style={{
													fontSize: 10,
													padding: "3px 8px",
													background: "transparent",
													color: fg,
													border: `1px solid ${border}`,
													borderRadius: 4,
													cursor: "pointer",
												}}
												type="button">
												📋 Duplicate
											</button>
											<button
												onClick={() => deleteTransect(t.id)}
												style={{
													fontSize: 10,
													padding: "3px 8px",
													background: "transparent",
													color: "#ef4444",
													border: "1px solid rgba(239,68,68,0.35)",
													borderRadius: 4,
													cursor: "pointer",
												}}
												type="button">
												🗑 Delete
											</button>
											<div style={{ flex: 1 }} />
											<button
												disabled={Boolean(agentBusy)}
												onClick={() => {
													setAgentError(null)
													handleAskAgent(t, activeProfileData)
												}}
												style={{
													fontSize: 10,
													padding: "4px 12px",
													background: isBusy ? "rgba(99,102,241,0.4)" : "rgba(99,102,241,0.85)",
													color: "#fff",
													border: "none",
													borderRadius: 4,
													cursor: isBusy ? "wait" : "pointer",
													fontWeight: 600,
												}}
												type="button">
												{isBusy ? "⏳ Sending…" : "✨ Ask Agent"}
											</button>
										</div>
									</div>
								)}
							</div>
						)
					})}
				</div>
			)}

			{/* Gallery save dialog */}
			{gallerySaveOpen && transects.length > 0 && (
				<div
					style={{
						background: isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)",
						border: `1px solid ${border}`,
						borderRadius: 6,
						padding: 12,
						display: "grid",
						gap: 8,
					}}>
					<div style={{ fontWeight: 700, fontSize: 12 }}>Save to My Gallery</div>
					<input
						autoFocus
						onChange={(e) => setGalleryTitle(e.target.value)}
						placeholder="Title"
						style={{ ...inputStyle, width: "100%" }}
						value={galleryTitle}
					/>
					<input
						onChange={(e) => setGalleryDesc(e.target.value)}
						placeholder="Description (optional)"
						style={{ ...inputStyle, width: "100%" }}
						value={galleryDesc}
					/>
					<input
						onChange={(e) => setGalleryTagsRaw(e.target.value)}
						placeholder="Tags: comma-separated (optional)"
						style={{ ...inputStyle, width: "100%" }}
						value={galleryTagsRaw}
					/>
					<div style={{ display: "flex", gap: 6 }}>
						<button
							disabled={!galleryTitle.trim()}
							onClick={() => {
								const target = activeCollectionId !== "all" ? filtered : transects
								const col = collections.find((c) => c.id === activeCollectionId)
								const tags = galleryTagsRaw
									.split(",")
									.map((t) => t.trim())
									.filter(Boolean)
								const saved = addToMyGallery({
									type: "transect_collection",
									title: galleryTitle.trim(),
									description: galleryDesc.trim(),
									tags,
									pinned: false,
									payload: {
										collectionName: col?.name ?? "All Transects",
										transects: target,
										collections: col ? [col] : collections,
									},
								})
								onSaveToGallery?.(saved)
								setGallerySaveOpen(false)
								setGalleryTitle("")
								setGalleryDesc("")
								setGalleryTagsRaw("")
							}}
							style={{
								flex: 1,
								fontSize: 11,
								padding: "5px 8px",
								background: "var(--vscode-button-background)",
								color: "var(--vscode-button-foreground)",
								border: "none",
								borderRadius: 3,
								cursor: galleryTitle.trim() ? "pointer" : "not-allowed",
							}}
							type="button">
							Save
						</button>
						<button
							onClick={() => setGallerySaveOpen(false)}
							style={{
								fontSize: 11,
								padding: "5px 8px",
								background: "transparent",
								border: `1px solid ${border}`,
								borderRadius: 3,
								cursor: "pointer",
								color: "inherit",
							}}
							type="button">
							Cancel
						</button>
					</div>
				</div>
			)}

			{/* Footer actions */}
			{transects.length > 0 && (
				<div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
					<button
						onClick={() => {
							const target = activeCollectionId !== "all" ? filtered : transects
							const col = collections.find((c) => c.id === activeCollectionId)
							const defaultTitle = col ? col.name : `Transects – ${new Date().toLocaleDateString()}`
							setGalleryTitle(defaultTitle)
							setGalleryDesc(col?.description ?? "")
							setGalleryTagsRaw("transect")
							setGallerySaveOpen((v) => !v)
						}}
						style={{
							fontSize: 10,
							padding: "4px 10px",
							background: gallerySaveOpen ? "rgba(16,185,129,0.2)" : "rgba(16,185,129,0.1)",
							color: "#6ee7b7",
							border: `1px solid ${gallerySaveOpen ? "rgba(16,185,129,0.5)" : "rgba(16,185,129,0.3)"}`,
							borderRadius: 4,
							cursor: "pointer",
							fontWeight: 600,
						}}
						type="button">
						📌 Save to My Gallery
					</button>
					<button
						disabled={Boolean(agentBusy)}
						onClick={() => {
							setAgentError(null)
							setBatchOpen((v) => !v)
						}}
						style={{
							fontSize: 10,
							padding: "4px 12px",
							background: batchOpen ? "rgba(99,102,241,0.25)" : "rgba(99,102,241,0.1)",
							color: batchOpen ? "#a5b4fc" : fg,
							border: `1px solid ${batchOpen ? "rgba(99,102,241,0.5)" : border}`,
							borderRadius: 4,
							cursor: agentBusy ? "wait" : "pointer",
							fontWeight: 600,
						}}
						type="button">
						{agentBusy === "batch"
							? "⏳ Sending…"
							: `✨ Batch Ask Agent (${(activeCollectionId !== "all" ? filtered : transects).length})`}
					</button>
				</div>
			)}
		</div>
	)
}

// ─── Sub-components ────────────────────────────────────────────────────────────

const FieldLabel: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
	<label
		style={{
			fontSize: 9,
			opacity: 0.55,
			display: "block",
			marginBottom: 3,
			fontWeight: 600,
			textTransform: "uppercase",
			letterSpacing: "0.05em",
			...style,
		}}>
		{children}
	</label>
)

const MetricChip: React.FC<{ label: string; value: string }> = ({ label, value }) => (
	<span
		style={{
			fontSize: 9,
			padding: "2px 7px",
			borderRadius: 8,
			background: "rgba(99,102,241,0.1)",
			border: "1px solid rgba(99,102,241,0.2)",
			color: "#a5b4fc",
			whiteSpace: "nowrap",
		}}>
		<span style={{ opacity: 0.7 }}>{label}: </span>
		<span style={{ fontWeight: 700 }}>{value}</span>
	</span>
)

function MultiSeriesChart({
	series,
	isDark,
	onHover,
}: {
	series: LayerSeries[]
	isDark: boolean
	onHover?: (coord: { lon: number; lat: number } | null) => void
}) {
	const [hover, setHover] = useState<{ seriesIdx: number; ptIdx: number } | null>(null)
	const muted = isDark ? "#64748b" : "#94a3b8"
	const chartBg = isDark ? "#0f172a" : "#f8fafc"

	const nonEmpty = series.filter((s) => s.data.length > 0)
	if (nonEmpty.length === 0) {
		return (
			<div
				style={{
					height: 110,
					background: chartBg,
					borderRadius: 4,
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					fontSize: 10,
					color: muted,
					textAlign: "center",
					padding: "0 12px",
				}}>
				No raster data for any visible layer under this line.
			</div>
		)
	}

	// Global min/max across all series for shared Y axis
	const allValues = nonEmpty.flatMap((s) => s.data.map((d) => d.value))
	const gMin = Math.min(...allValues)
	const gMax = Math.max(...allValues)
	const gRange = gMax - gMin || 1
	const padMin = gMin - gRange * 0.1
	const padMax = gMax + gRange * 0.1
	const padRange = padMax - padMin
	const maxDist = Math.max(...nonEmpty.map((s) => s.data[s.data.length - 1].distKm))
	const toX = (d: number) => (d / maxDist) * 100
	const toY = (v: number) => 100 - ((v - padMin) / padRange) * 100

	const hovered = hover != null ? nonEmpty[hover.seriesIdx]?.data[hover.ptIdx] : null
	const hoveredColor = hover != null ? nonEmpty[hover.seriesIdx]?.color : undefined

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
			{/* Legend */}
			<div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
				{nonEmpty.map((s) => (
					<span key={s.layerId} style={{ fontSize: 9, display: "flex", alignItems: "center", gap: 3, color: muted }}>
						<span style={{ display: "inline-block", width: 14, height: 2, background: s.color, borderRadius: 1 }} />
						{s.layerName}
						{s.units ? ` (${s.units})` : ""}
					</span>
				))}
			</div>
			<div
				onMouseLeave={() => {
					setHover(null)
					onHover?.(null)
				}}
				onMouseMove={(e) => {
					const rect = e.currentTarget.getBoundingClientRect()
					const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
					const dist = frac * maxDist
					// find closest series point
					let bestSeries = 0
					let bestPt = 0
					let bestDelta = Infinity
					nonEmpty.forEach((s, si) => {
						s.data.forEach((d, pi) => {
							const delta = Math.abs(d.distKm - dist)
							if (delta < bestDelta) {
								bestDelta = delta
								bestSeries = si
								bestPt = pi
							}
						})
					})
					setHover({ seriesIdx: bestSeries, ptIdx: bestPt })
					const pt = nonEmpty[bestSeries]?.data[bestPt]
					if (pt) onHover?.({ lon: pt.lon, lat: pt.lat })
				}}
				style={{ position: "relative", height: 110, background: chartBg, borderRadius: 4, overflow: "hidden" }}>
				<svg height="100%" preserveAspectRatio="none" style={{ display: "block" }} viewBox="0 0 100 100" width="100%">
					{nonEmpty.map((s) => {
						const pts = s.data.map((d) => `${toX(d.distKm)},${toY(d.value)}`).join(" ")
						return (
							<polyline
								fill="none"
								key={s.layerId}
								opacity={hover && nonEmpty[hover.seriesIdx]?.layerId !== s.layerId ? 0.4 : 1}
								points={pts}
								stroke={s.color}
								strokeWidth="1.5"
								vectorEffect="non-scaling-stroke"
							/>
						)
					})}
					{hovered && (
						<line
							stroke={muted}
							strokeWidth="0.5"
							vectorEffect="non-scaling-stroke"
							x1={toX(hovered.distKm)}
							x2={toX(hovered.distKm)}
							y1="0"
							y2="100"
						/>
					)}
					{hovered && (
						<circle
							cx={toX(hovered.distKm)}
							cy={toY(hovered.value)}
							fill={hoveredColor ?? "#fff"}
							r="2"
							vectorEffect="non-scaling-stroke"
						/>
					)}
				</svg>
				{hovered && (
					<div
						style={{
							position: "absolute",
							top: 4,
							left: toX(hovered.distKm) > 50 ? "auto" : "50%",
							right: toX(hovered.distKm) > 50 ? "50%" : "auto",
							transform: "translateX(-50%)",
							background: isDark ? "rgba(15,23,42,0.92)" : "rgba(255,255,255,0.95)",
							border: `1px solid ${muted}`,
							borderRadius: 3,
							padding: "2px 5px",
							fontSize: 9,
							color: isDark ? "#e2e8f0" : "#0f172a",
							pointerEvents: "none",
							whiteSpace: "nowrap",
						}}>
						<span style={{ color: hoveredColor }}>{nonEmpty[hover!.seriesIdx]?.layerName}</span> ·{" "}
						{hovered.distKm.toFixed(2)} km · {hovered.value.toFixed(2)}
					</div>
				)}
			</div>
			<div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: muted }}>
				<span>min {gMin.toFixed(2)}</span>
				<span>{maxDist.toFixed(2)} km</span>
				<span>max {gMax.toFixed(2)}</span>
			</div>
		</div>
	)
}

const StatusBadge: React.FC<{ status: TransectStatus }> = ({ status }) => {
	const opt = STATUS_OPTS.find((s) => s.value === status) ?? STATUS_OPTS[0]
	return <span style={{ fontSize: 9, color: opt.color, whiteSpace: "nowrap", fontWeight: 600, opacity: 0.9 }}>{opt.label}</span>
}

const PriorityBadge: React.FC<{ priority: TransectPriority }> = ({ priority }) => {
	if (!priority) return null
	const opt = PRIORITY_OPTS.find((p) => p.value === priority)
	if (!opt) return null
	return (
		<span
			style={{
				fontSize: 9,
				color: opt.color,
				whiteSpace: "nowrap",
				fontWeight: 600,
				padding: "1px 5px",
				background: `${opt.color}22`,
				borderRadius: 8,
			}}>
			{opt.label}
		</span>
	)
}

function ProfileChart({
	profile,
	color,
	isDark,
	onHover,
}: {
	profile: ProfileResult
	color: string
	isDark: boolean
	onHover?: (coord: { lon: number; lat: number } | null) => void
}) {
	const [hover, setHover] = useState<number | null>(null)
	const muted = isDark ? "#64748b" : "#94a3b8"
	const chartBg = isDark ? "#0f172a" : "#f8fafc"

	const { data, sampledLayerName, units } = profile
	const stats = useMemo(() => {
		if (data.length === 0) return null
		const values = data.map((d) => d.value)
		const min = Math.min(...values)
		const max = Math.max(...values)
		return { min, max, mean: values.reduce((a, b) => a + b, 0) / values.length, lengthKm: data[data.length - 1].distKm }
	}, [data])

	if (data.length === 0 || !stats) {
		return (
			<div
				style={{
					height: 110,
					background: chartBg,
					borderRadius: 4,
					display: "flex",
					flexDirection: "column",
					alignItems: "center",
					justifyContent: "center",
					gap: 4,
					fontSize: 10,
					color: muted,
					textAlign: "center",
					padding: "0 12px",
				}}>
				<span>No raster data under this line.</span>
				<span style={{ fontSize: 9, opacity: 0.8 }}>
					Make a raster layer with numeric pixels visible, then re-open this profile.
				</span>
			</div>
		)
	}

	const range = stats.max - stats.min || 1
	const padMin = stats.min - range * 0.1
	const padMax = stats.max + range * 0.1
	const padRange = padMax - padMin
	const toY = (v: number) => 100 - ((v - padMin) / padRange) * 100
	const pts = data.map((d, i) => `${(i / (data.length - 1)) * 100},${toY(d.value)}`).join(" ")
	const hoverPt = hover != null ? data[hover] : null
	const hoverX = hover != null ? (hover / (data.length - 1)) * 100 : 0

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
			<div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: muted }}>
				<span>{sampledLayerName ? `📡 ${sampledLayerName}${units ? ` (${units})` : ""}` : "Profile"}</span>
				<span>{stats.lengthKm.toFixed(2)} km</span>
			</div>
			<div
				onMouseLeave={() => {
					setHover(null)
					onHover?.(null)
				}}
				onMouseMove={(e) => {
					const rect = e.currentTarget.getBoundingClientRect()
					const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
					const idx = Math.round(frac * (data.length - 1))
					setHover(idx)
					const pt = data[idx]
					if (pt) onHover?.({ lon: pt.lon, lat: pt.lat })
				}}
				style={{ position: "relative", height: 100, background: chartBg, borderRadius: 4, overflow: "hidden" }}>
				<svg height="100%" preserveAspectRatio="none" style={{ display: "block" }} viewBox="0 0 100 100" width="100%">
					<polygon fill={color} opacity="0.18" points={`0,100 ${pts} 100,100`} />
					<polyline fill="none" points={pts} stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
					{hoverPt && (
						<line
							stroke={muted}
							strokeWidth="0.5"
							vectorEffect="non-scaling-stroke"
							x1={hoverX}
							x2={hoverX}
							y1="0"
							y2="100"
						/>
					)}
					{hoverPt && (
						<circle cx={hoverX} cy={toY(hoverPt.value)} fill={color} r="2" vectorEffect="non-scaling-stroke" />
					)}
				</svg>
				{hoverPt && (
					<div
						style={{
							position: "absolute",
							top: 4,
							left: hoverX > 50 ? "auto" : "50%",
							right: hoverX > 50 ? "50%" : "auto",
							transform: "translateX(-50%)",
							background: isDark ? "rgba(15,23,42,0.92)" : "rgba(255,255,255,0.95)",
							border: `1px solid ${muted}`,
							borderRadius: 3,
							padding: "2px 5px",
							fontSize: 9,
							color: isDark ? "#e2e8f0" : "#0f172a",
							pointerEvents: "none",
							whiteSpace: "nowrap",
						}}>
						{hoverPt.distKm.toFixed(2)} km · {hoverPt.value.toFixed(2)}
					</div>
				)}
			</div>
			<div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: muted }}>
				<span>min {stats.min.toFixed(2)}</span>
				<span>mean {stats.mean.toFixed(2)}</span>
				<span>max {stats.max.toFixed(2)}</span>
			</div>
		</div>
	)
}
