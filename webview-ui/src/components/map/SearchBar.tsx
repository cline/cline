import React, { useCallback, useEffect, useRef, useState } from "react"
import { isConus } from "./mapHydroGuards"
import { sendHydroMapCommand } from "./mapHydrologyBridge"

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
	mapCenter?: { lat: number; lon: number }
	onResultSelect?: (result: SearchResult) => void
	onStatus?: (text: string) => void
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
	if (!trimmed) return null

	const ddMatch = trimmed.match(/^\s*([+-]?\d+\.?\d*)\s*[,\s]\s*([+-]?\d+\.?\d*)\s*$/)
	if (ddMatch) {
		const lat = parseFloat(ddMatch[1])
		const lon = parseFloat(ddMatch[2])
		if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
			return { label: `${lat.toFixed(4)}, ${lon.toFixed(4)}`, lat, lon, source: "coordinate" }
		}
	}

	const dmsMatch = trimmed.match(/^(\d+)°(\d+)'\s*([NnSs])\s*[,\s]\s*(\d+)°(\d+)'\s*([EeWw])$/)
	if (dmsMatch) {
		const lat = (parseInt(dmsMatch[1], 10) + parseInt(dmsMatch[2], 10) / 60) * (dmsMatch[3].toUpperCase() === "S" ? -1 : 1)
		const lon = (parseInt(dmsMatch[4], 10) + parseInt(dmsMatch[5], 10) / 60) * (dmsMatch[6].toUpperCase() === "W" ? -1 : 1)
		if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
			return { label: trimmed, lat, lon, source: "coordinate" }
		}
	}
	return null
}

function localGaugeSearch(query: string): SearchResult[] {
	const q = query.trim().toLowerCase()
	if (!q) return []
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

export const SearchBar: React.FC<SearchBarProps> = ({ embedded = false, viewBbox, mapCenter, onResultSelect, onStatus }) => {
	const [query, setQuery] = useState("")
	const [results, setResults] = useState<SearchResult[]>([])
	const [loading, setLoading] = useState(false)
	const [gaugesBusy, setGaugesBusy] = useState(false)
	const [selectedIdx, setSelectedIdx] = useState(-1)
	const abortRef = useRef<AbortController | null>(null)

	const conus = mapCenter !== undefined ? isConus(mapCenter.lat, mapCenter.lon) : false

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
			if (abortRef.current) abortRef.current.abort()
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

	const showGaugesInView = async () => {
		if (!viewBbox || !mapCenter || !conus) {
			onStatus?.("Pan to CONUS to load gauges in the current map extent.")
			return
		}
		setGaugesBusy(true)
		onStatus?.("Loading USGS gauges in view…")
		try {
			const r = await sendHydroMapCommand("gaugesInView", {
				lat: mapCenter.lat,
				lon: mapCenter.lon,
				...viewBbox,
			})
			onStatus?.(r.ok ? r.message || "Gauges added to map" : r.error || r.message || "No gauges found")
		} catch (e) {
			onStatus?.(e instanceof Error ? e.message : String(e))
		} finally {
			setGaugesBusy(false)
		}
	}

	const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (results.length === 0) return
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

	const rootClass = embedded ? "map-search-root map-search-root--embedded" : "map-search-root"

	return (
		<div className={rootClass}>
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

			{conus && viewBbox && (
				<button
					className="map-search-gauges-btn"
					disabled={gaugesBusy}
					onClick={() => void showGaugesInView()}
					title="Query NWIS for streamgages in the current map extent"
					type="button">
					{gaugesBusy ? "Loading gauges…" : "Show gauges in view"}
				</button>
			)}

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
		</div>
	)
}

export default SearchBar
