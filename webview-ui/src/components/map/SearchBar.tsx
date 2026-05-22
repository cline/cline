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
			return {
				label: `${lat.toFixed(4)}, ${lon.toFixed(4)}`,
				lat,
				lon,
				source: "coordinate",
			}
		}
	}

	const dmsMatch = trimmed.match(/^(\d+)°(\d+)'\s*([NnSs])\s*[,\s]\s*(\d+)°(\d+)'\s*([EeWw])$/)
	if (dmsMatch) {
		const latDeg = parseInt(dmsMatch[1], 10)
		const latMin = parseInt(dmsMatch[2], 10)
		const latDir = dmsMatch[3].toUpperCase()
		const lonDeg = parseInt(dmsMatch[4], 10)
		const lonMin = parseInt(dmsMatch[5], 10)
		const lonDir = dmsMatch[6].toUpperCase()
		const lat = (latDeg + latMin / 60) * (latDir === "S" ? -1 : 1)
		const lon = (lonDeg + lonMin / 60) * (lonDir === "W" ? -1 : 1)
		if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
			return {
				label: trimmed,
				lat,
				lon,
				source: "coordinate",
			}
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

export const SearchBar: React.FC<SearchBarProps> = ({ mapStyle = "dark", viewBbox, mapCenter, onResultSelect, onStatus }) => {
	const [query, setQuery] = useState("")
	const [results, setResults] = useState<SearchResult[]>([])
	const [loading, setLoading] = useState(false)
	const [gaugesBusy, setGaugesBusy] = useState(false)
	const [selectedIdx, setSelectedIdx] = useState(-1)
	const inputRef = useRef<HTMLInputElement>(null)
	const abortRef = useRef<AbortController | null>(null)

	const isDark = mapStyle === "dark"
	const fg = isDark ? "var(--vscode-foreground, #ddd)" : "var(--vscode-foreground, #222)"
	const bg = isDark ? "rgba(20,20,28,0.96)" : "rgba(248,248,250,0.97)"
	const border = isDark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.14)"
	const accent = "var(--vscode-button-background, #0e639c)"

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
						(h) =>
							!localGauges.some((g) => g.meta?.gauge_id === h.meta?.gauge_id) &&
							(h.meta?.dam_search_hint === undefined || h.source === "dam"),
					)
				} catch {
					/* host hydro unavailable */
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

	useEffect(() => {
		return () => {
			abortRef.current?.abort()
		}
	}, [])

	const handleSelect = (result: SearchResult) => {
		if (result.meta?.dam_search_hint) {
			setQuery(result.meta.dam_search_hint)
			return
		}
		setQuery(result.label)
		setResults([])
		setSelectedIdx(-1)
		onResultSelect?.(result)
	}

	const showGaugesInView = async () => {
		if (!viewBbox || !mapCenter || !conus) {
			onStatus?.("Pan to CONUS and open search to load gauges in view.")
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
		} else if (e.key === "Enter") {
			e.preventDefault()
			if (selectedIdx >= 0 && selectedIdx < results.length) {
				handleSelect(results[selectedIdx])
			}
		} else if (e.key === "Escape") {
			setResults([])
			setSelectedIdx(-1)
		}
	}

	const sourceIcon = (source: SearchResult["source"]) => {
		if (source === "gauge") return "🌊"
		if (source === "dam") return "🏗"
		if (source === "coordinate") return "📍"
		return "🌍"
	}

	return (
		<div style={{ position: "relative", width: 280 }}>
			<input
				aria-autocomplete="list"
				aria-controls="search-results-list"
				aria-expanded={results.length > 0}
				aria-label="Search places, coordinates, gauges, or dams"
				onChange={(e) => setQuery(e.target.value)}
				onKeyDown={handleKeyDown}
				placeholder="Place, gauge ID, dam, or 40.45,-86.85"
				ref={inputRef}
				style={{
					width: "100%",
					padding: "6px 10px 6px 28px",
					fontSize: 12,
					borderRadius: 4,
					border: `1px solid ${border}`,
					background: bg,
					color: fg,
					outline: "none",
					fontFamily: "var(--vscode-font-family, system-ui, sans-serif)",
				}}
				type="text"
				value={query}
			/>
			<span
				style={{
					position: "absolute",
					left: 8,
					top: "50%",
					transform: "translateY(-50%)",
					fontSize: 13,
					opacity: 0.5,
					pointerEvents: "none",
				}}>
				🔍
			</span>
			{loading && (
				<span
					style={{
						position: "absolute",
						right: 8,
						top: "50%",
						transform: "translateY(-50%)",
						fontSize: 10,
						opacity: 0.6,
					}}>
					⏳
				</span>
			)}

			{conus && viewBbox && (
				<button
					disabled={gaugesBusy}
					onClick={() => void showGaugesInView()}
					style={{
						marginTop: 6,
						width: "100%",
						padding: "5px 8px",
						fontSize: 10,
						borderRadius: 4,
						border: `1px solid ${border}`,
						background: "transparent",
						color: fg,
						cursor: gaugesBusy ? "wait" : "pointer",
					}}
					title="Query NWIS for streamgages in the current map extent"
					type="button">
					{gaugesBusy ? "Loading gauges…" : "Show gauges in view"}
				</button>
			)}

			{results.length > 0 && (
				<div
					aria-expanded={results.length > 0}
					aria-label={`${results.length} search results`}
					id="search-results-list"
					role="listbox"
					style={{
						position: "absolute",
						top: conus && viewBbox ? "calc(100% + 34px)" : "calc(100% + 4px)",
						left: 0,
						right: 0,
						zIndex: 10,
						background: bg,
						border: `1px solid ${border}`,
						borderRadius: 4,
						boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
						maxHeight: 280,
						overflowY: "auto",
					}}>
					{results.map((r, idx) => (
						<button
							aria-selected={idx === selectedIdx}
							key={`${r.source}-${r.label}-${idx}`}
							onClick={() => handleSelect(r)}
							role="option"
							style={{
								display: "flex",
								alignItems: "center",
								gap: 6,
								width: "100%",
								padding: "6px 10px",
								background: idx === selectedIdx ? `${accent}33` : "transparent",
								border: "none",
								borderBottom: `1px solid ${border}`,
								color: fg,
								cursor: "pointer",
								textAlign: "left",
								fontSize: 11,
								fontFamily: "inherit",
							}}
							type="button">
							<span style={{ fontSize: 12, flexShrink: 0 }}>{sourceIcon(r.source)}</span>
							<span
								style={{
									overflow: "hidden",
									textOverflow: "ellipsis",
									whiteSpace: "nowrap",
								}}>
								{r.label}
							</span>
						</button>
					))}
				</div>
			)}
		</div>
	)
}

export default SearchBar
