import React, { useCallback, useEffect, useRef, useState } from "react"
import { sendHydroMapCommand } from "./mapHydrologyBridge"
import { loadMapWorkspace, type MapBookmark, saveMapWorkspace } from "./mapWorkspace"

export interface SearchResult {
	label: string
	lon: number
	lat: number
	source: "nominatim" | "gauge" | "dam" | "coordinate"
	bbox?: [number, number, number, number]
	meta?: Record<string, string>
}

interface SearchBarProps {
	mapStyle?: "dark" | "light"
	/** When true, search lives inside the ribbon panel (no floating overlay). */
	embedded?: boolean
	viewBbox?: { minLon: number; minLat: number; maxLon: number; maxLat: number }
	onResultSelect?: (result: SearchResult) => void
	/** Current view state — needed to save bookmarks. */
	currentView?: { longitude: number; latitude: number; zoom: number; pitch?: number; bearing?: number }
}

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"

const USGS_GAUGE_SITES: Record<string, { name: string; lat: number; lon: number }> = {
	"01031500": { name: "Mattawamkeag River at Mattawamkeag, ME", lat: 45.5146, lon: -68.33 },
	"01052500": { name: "Piscataquis River at Dover-Foxcroft, ME", lat: 45.1834, lon: -69.2278 },
	"02361000": { name: "Sepulga River at Brooklyn, AL", lat: 31.4836, lon: -86.8686 },
	"03335000": { name: "Wabash River at Huntington, IN", lat: 40.8834, lon: -85.5 },
	"06431500": { name: "Rapid Creek at Rapid City, SD", lat: 44.0697, lon: -103.231 },
	"09380000": { name: "Colorado River at Lees Ferry, AZ", lat: 36.8642, lon: -111.5877 },
	"11532500": { name: "Trinity River near Douglas City, CA", lat: 40.5843, lon: -123.6469 },
}

function parseCoordinateInput(raw: string): SearchResult | null {
	const trimmed = raw.trim()
	if (!trimmed) {
		return null
	}

	// Decimal degrees: "45.123, -73.456" or "45.123 -73.456"
	const ddMatch = trimmed.match(/^\s*([+-]?\d+\.?\d*)\s*[,\s]\s*([+-]?\d+\.?\d*)\s*$/)
	if (ddMatch) {
		const lat = parseFloat(ddMatch[1])
		const lon = parseFloat(ddMatch[2])
		if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
			return { label: `${lat.toFixed(4)}, ${lon.toFixed(4)}`, lat, lon, source: "coordinate" }
		}
	}

	// DMS: "45°29'N, 73°34'W"
	const dmsMatch = trimmed.match(/^(\d+)°(\d+)'\s*([NnSs])\s*[,\s]\s*(\d+)°(\d+)'\s*([EeWw])$/)
	if (dmsMatch) {
		const lat = (parseInt(dmsMatch[1], 10) + parseInt(dmsMatch[2], 10) / 60) * (dmsMatch[3].toUpperCase() === "S" ? -1 : 1)
		const lon = (parseInt(dmsMatch[4], 10) + parseInt(dmsMatch[5], 10) / 60) * (dmsMatch[6].toUpperCase() === "W" ? -1 : 1)
		if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
			return { label: trimmed, lat, lon, source: "coordinate" }
		}
	}

	// UTM: "zone 44N 269000 3042000" (simplified — zone easting northing)
	const utmMatch = trimmed.match(/^(\d{1,2})\s*([Nn])\s+(\d+)\s+(\d+)$/)
	if (utmMatch) {
		// Very basic UTM→LatLon approximation for zone N/S only (good enough to fly to)
		const zone = parseInt(utmMatch[1], 10)
		const isNorth = utmMatch[2].toUpperCase() === "N"
		const easting = parseFloat(utmMatch[3])
		const northing = parseFloat(utmMatch[4])
		const lon = (zone - 1) * 6 - 180 + 3 + (easting - 500000) / (111320 * Math.cos((northing / 6378137) * (180 / Math.PI)))
		const lat = (northing - (isNorth ? 0 : 10000000)) / 111132
		if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
			return { label: `UTM ${zone}N ${easting} ${northing}`, lat, lon, source: "coordinate" }
		}
	}
	return null
}

function localGaugeSearch(query: string): SearchResult[] {
	const q = query.trim().toLowerCase()
	if (!q) {
		return []
	}
	const out: SearchResult[] = []
	for (const [id, info] of Object.entries(USGS_GAUGE_SITES)) {
		if (id.includes(q) || info.name.toLowerCase().includes(q)) {
			out.push({
				label: `${id} — ${info.name}`,
				lat: info.lat,
				lon: info.lon,
				source: "gauge",
				meta: { gauge_id: id },
			})
		}
	}
	return out
}

function hydroHitsToResults(
	hits: Array<{ label: string; lat: number; lon: number; source: string; meta?: Record<string, string> }>,
): SearchResult[] {
	return hits
		.filter((h) => h.source === "gauge" || h.source === "dam")
		.map((h) => ({
			label: h.label,
			lat: h.lat,
			lon: h.lon,
			source: h.source as "gauge" | "dam",
			meta: h.meta,
		}))
}

const SOURCE_ICON: Record<SearchResult["source"], string> = {
	gauge: "🌊",
	dam: "🏗",
	coordinate: "📍",
	nominatim: "🌍",
}

const fg = "var(--vscode-foreground, #ccc)"
const border = "rgba(255,255,255,0.12)"
const subtle = "rgba(255,255,255,0.04)"
const accent = "var(--vscode-button-background, #0e639c)"

const smallBtn = (active?: boolean): React.CSSProperties => ({
	fontSize: 10,
	padding: "2px 7px",
	background: active ? accent : "transparent",
	color: active ? "#fff" : fg,
	border: `1px solid ${active ? accent : border}`,
	borderRadius: 3,
	cursor: "pointer",
	whiteSpace: "nowrap" as const,
})

// ─── Bookmarks Panel ──────────────────────────────────────────────────────────

const BookmarksPanel: React.FC<{
	currentView?: SearchBarProps["currentView"]
	onFlyTo: (bk: MapBookmark) => void
}> = ({ currentView, onFlyTo }) => {
	const [bookmarks, setBookmarks] = useState<MapBookmark[]>(() => loadMapWorkspace().bookmarks ?? [])
	const [newName, setNewName] = useState("")
	const [naming, setNaming] = useState(false)

	const saveBookmark = () => {
		if (!currentView || !newName.trim()) {
			return
		}
		const bk: MapBookmark = {
			id: `bk_${Date.now()}`,
			name: newName.trim(),
			longitude: currentView.longitude,
			latitude: currentView.latitude,
			zoom: currentView.zoom,
			pitch: currentView.pitch,
			bearing: currentView.bearing,
			createdAt: new Date().toISOString(),
		}
		const next = [...bookmarks, bk]
		setBookmarks(next)
		saveMapWorkspace({ bookmarks: next })
		setNewName("")
		setNaming(false)
	}

	const removeBookmark = (id: string) => {
		const next = bookmarks.filter((b) => b.id !== id)
		setBookmarks(next)
		saveMapWorkspace({ bookmarks: next })
	}

	return (
		<div style={{ marginTop: 8 }}>
			<div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
				<span style={{ fontSize: 10, fontWeight: 600, opacity: 0.8, flex: 1 }}>📌 Bookmarks</span>
				{currentView && !naming && (
					<button
						onClick={() => setNaming(true)}
						style={smallBtn()}
						title="Save current view as bookmark"
						type="button">
						＋ Save view
					</button>
				)}
			</div>

			{naming && (
				<div style={{ display: "flex", gap: 5, marginBottom: 6 }}>
					<input
						autoFocus
						maxLength={40}
						onChange={(e) => setNewName(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								saveBookmark()
							}
							if (e.key === "Escape") {
								setNaming(false)
								setNewName("")
							}
						}}
						placeholder="Bookmark name…"
						style={{
							flex: 1,
							fontSize: 11,
							padding: "3px 6px",
							background: "rgba(255,255,255,0.07)",
							color: fg,
							border: `1px solid ${border}`,
							borderRadius: 3,
						}}
						type="text"
						value={newName}
					/>
					<button onClick={saveBookmark} style={smallBtn(true)} title="Save" type="button">
						✓
					</button>
					<button
						onClick={() => {
							setNaming(false)
							setNewName("")
						}}
						style={smallBtn()}
						title="Cancel"
						type="button">
						✕
					</button>
				</div>
			)}

			{bookmarks.length === 0 ? (
				<div style={{ fontSize: 10, opacity: 0.5, padding: "4px 0", textAlign: "center" }}>
					No bookmarks yet. Navigate to a location and click ＋ Save view.
				</div>
			) : (
				<div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
					{bookmarks.map((bk) => (
						<div
							key={bk.id}
							style={{
								display: "flex",
								alignItems: "center",
								gap: 5,
								padding: "3px 6px",
								background: subtle,
								border: `1px solid ${border}`,
								borderRadius: 3,
							}}>
							<button
								onClick={() => onFlyTo(bk)}
								style={{
									flex: 1,
									textAlign: "left",
									background: "transparent",
									border: "none",
									color: fg,
									cursor: "pointer",
									fontSize: 11,
									padding: 0,
									overflow: "hidden",
									textOverflow: "ellipsis",
									whiteSpace: "nowrap",
								}}
								title={`${bk.latitude.toFixed(4)}, ${bk.longitude.toFixed(4)} · zoom ${bk.zoom.toFixed(1)}`}
								type="button">
								{bk.name}
							</button>
							<span style={{ fontSize: 9, opacity: 0.45, whiteSpace: "nowrap" }}>z{bk.zoom.toFixed(1)}</span>
							<button
								onClick={() => removeBookmark(bk.id)}
								style={{
									background: "transparent",
									border: "none",
									color: "rgba(220,53,69,0.7)",
									cursor: "pointer",
									fontSize: 12,
									padding: 0,
									lineHeight: 1,
									flexShrink: 0,
								}}
								title="Remove bookmark"
								type="button">
								✕
							</button>
						</div>
					))}
				</div>
			)}
		</div>
	)
}

// ─── SearchBar ────────────────────────────────────────────────────────────────

export const SearchBar: React.FC<SearchBarProps> = ({ embedded = false, viewBbox, onResultSelect, currentView }) => {
	const [query, setQuery] = useState("")
	const [results, setResults] = useState<SearchResult[]>([])
	const [loading, setLoading] = useState(false)
	const [selectedIdx, setSelectedIdx] = useState(-1)
	const [coordInput, setCoordInput] = useState("")
	const [coordError, setCoordError] = useState("")
	const abortRef = useRef<AbortController | null>(null)

	const doSearch = useCallback(
		async (q: string) => {
			if (!q.trim()) {
				setResults([])
				return
			}
			setLoading(true)
			const coord = parseCoordinateInput(q)
			const localGauges = localGaugeSearch(q)

			let hydro: SearchResult[] = []
			if (q.trim().length >= 2) {
				try {
					const r = await sendHydroMapCommand("searchHydrology", {
						q: q.trim(),
						...(viewBbox ?? {}),
						limit: 15,
					})
					const hits =
						(r.result?.hits as Array<{
							label: string
							lat: number
							lon: number
							source: string
							meta?: Record<string, string>
						}>) ?? []
					hydro = hydroHitsToResults(hits).filter(
						(h) => !localGauges.some((g) => g.meta?.gauge_id === h.meta?.gauge_id),
					)
				} catch {
					/* hydro CLI unavailable */
				}
			}

			let nominatim: SearchResult[] = []
			if (abortRef.current) {
				abortRef.current.abort()
			}
			abortRef.current = new AbortController()
			try {
				const resp = await fetch(`${NOMINATIM_URL}?q=${encodeURIComponent(q)}&format=json&limit=5&polygon_geojson=0`, {
					signal: abortRef.current.signal,
					headers: {
						"Accept-Language": "en",
						"User-Agent": "AI-Hydro/1.0 (hydrology-research-tool)",
					},
				})
				if (resp.ok) {
					const data = await resp.json()
					nominatim = (data || [])
						.filter((item: { lat?: string; lon?: string }) => item.lat && item.lon)
						.map((item: { display_name: string; lat: string; lon: string; boundingbox?: string[] }) => ({
							label: item.display_name,
							lat: parseFloat(item.lat),
							lon: parseFloat(item.lon),
							source: "nominatim" as const,
							bbox: item.boundingbox
								? [
										parseFloat(item.boundingbox[2]),
										parseFloat(item.boundingbox[0]),
										parseFloat(item.boundingbox[3]),
										parseFloat(item.boundingbox[1]),
									]
								: undefined,
						}))
				}
			} catch {
				/* ignore */
			}

			const all = [...(coord ? [coord] : []), ...localGauges, ...hydro, ...nominatim]
			setResults(all)
			setSelectedIdx(all.length > 0 ? 0 : -1)
			setLoading(false)
		},
		[viewBbox],
	)

	useEffect(() => {
		const id = window.setTimeout(() => doSearch(query), 400)
		return () => window.clearTimeout(id)
	}, [query, doSearch])

	useEffect(() => () => abortRef.current?.abort(), [])

	const handleSelect = (result: SearchResult) => {
		setQuery(result.label)
		setResults([])
		setSelectedIdx(-1)
		onResultSelect?.(result)
	}

	const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (results.length === 0) {
			return
		}
		if (e.key === "ArrowDown") {
			e.preventDefault()
			setSelectedIdx((i) => Math.min(i + 1, results.length - 1))
		} else if (e.key === "ArrowUp") {
			e.preventDefault()
			setSelectedIdx((i) => Math.max(i - 1, 0))
		} else if (e.key === "Enter" && selectedIdx >= 0) {
			e.preventDefault()
			handleSelect(results[selectedIdx])
		} else if (e.key === "Escape") {
			setResults([])
			setSelectedIdx(-1)
		}
	}

	const handleGoToCoord = () => {
		setCoordError("")
		const result = parseCoordinateInput(coordInput)
		if (!result) {
			setCoordError("Unrecognised format. Try: 28.45, 77.02  or  28°27'N, 77°01'E  or  44N 269000 3042000")
			return
		}
		onResultSelect?.(result)
		setCoordInput("")
	}

	const rootClass = embedded ? "map-search-root map-search-root--embedded" : "map-search-root"

	return (
		<div className={rootClass}>
			{/* ── Place / gauge / name search ── */}
			<div className="map-search-field-wrap">
				<span aria-hidden="true" className="map-search-field-icon">
					🔍
				</span>
				<input
					aria-autocomplete="list"
					aria-controls="search-results-list"
					aria-expanded={results.length > 0}
					aria-label="Search places, coordinates, gauges, or dams"
					className="map-search-input"
					onChange={(e) => setQuery(e.target.value)}
					onKeyDown={handleKeyDown}
					placeholder="Place, gauge ID, dam, or lat,lon"
					type="text"
					value={query}
				/>
				{loading && (
					<span aria-hidden="true" className="map-search-field-spinner">
						⏳
					</span>
				)}
			</div>

			{results.length > 0 && (
				<div
					aria-label={`${results.length} search results`}
					className="map-search-results"
					id="search-results-list"
					role="listbox">
					{results.map((r, idx) => (
						<button
							aria-selected={idx === selectedIdx}
							className={`map-search-result-item${idx === selectedIdx ? " map-search-result-item--selected" : ""}`}
							key={`${r.source}-${r.label}-${idx}`}
							onClick={() => handleSelect(r)}
							role="option"
							type="button">
							<span aria-hidden="true" className="map-search-result-icon">
								{SOURCE_ICON[r.source]}
							</span>
							<span className="map-search-result-label">{r.label}</span>
						</button>
					))}
				</div>
			)}

			{/* ── Go to coordinates ── */}
			<div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${border}` }}>
				<div style={{ fontSize: 10, fontWeight: 600, opacity: 0.8, marginBottom: 4 }}>📍 Go to coordinates</div>
				<div style={{ display: "flex", gap: 5 }}>
					<input
						onChange={(e) => {
							setCoordInput(e.target.value)
							setCoordError("")
						}}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								handleGoToCoord()
							}
						}}
						placeholder="28.45, 77.02  or  44N 269000 3042000"
						style={{
							flex: 1,
							fontSize: 10,
							padding: "3px 6px",
							background: "rgba(255,255,255,0.07)",
							color: fg,
							border: `1px solid ${coordError ? "rgba(220,53,69,0.6)" : border}`,
							borderRadius: 3,
							minWidth: 0,
						}}
						type="text"
						value={coordInput}
					/>
					<button
						onClick={handleGoToCoord}
						style={smallBtn(!!coordInput.trim())}
						title="Fly to coordinates"
						type="button">
						Go
					</button>
				</div>
				{coordError && (
					<div
						style={{
							fontSize: 9,
							color: "var(--vscode-editorError-foreground, #f48771)",
							marginTop: 3,
							lineHeight: 1.3,
						}}>
						{coordError}
					</div>
				)}
				<div style={{ fontSize: 9, opacity: 0.4, marginTop: 3 }}>Accepts decimal · DMS · UTM (zone easting northing)</div>
			</div>

			{/* ── Bookmarks ── */}
			<BookmarksPanel
				currentView={currentView}
				onFlyTo={(bk) =>
					onResultSelect?.({
						label: bk.name,
						lat: bk.latitude,
						lon: bk.longitude,
						source: "coordinate",
					})
				}
			/>
		</div>
	)
}

export default SearchBar
