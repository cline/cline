import type { MapViewState } from "@deck.gl/core"
import React, { useCallback, useEffect, useState } from "react"
import { isConus } from "./mapHydroGuards"
import { sendHydroMapCommand } from "./mapHydrologyBridge"

interface Preset {
	id: string
	label: string
	bbox: number[]
}

interface HydrographyPanelProps {
	mapStyle: "dark" | "light"
	viewState: MapViewState
	onStatus?: (text: string) => void
}

const HydrographyPanel: React.FC<HydrographyPanelProps> = ({ mapStyle, viewState, onStatus }) => {
	const isDark = mapStyle === "dark"
	const fg = isDark ? "var(--vscode-foreground, #ddd)" : "var(--vscode-foreground, #222)"
	const muted = isDark ? "rgba(255,255,255,0.6)" : "rgba(0,0,0,0.55)"
	const border = isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.12)"
	const accentBg = isDark ? "rgba(30,90,140,0.45)" : "rgba(14,99,156,0.15)"
	const [busy, setBusy] = useState(false)
	const [status, setStatus] = useState("")
	const [presets, setPresets] = useState<Preset[]>([])
	const [includeCatchments, setIncludeCatchments] = useState(false)
	const [hucLevel, setHucLevel] = useState(8)
	const [showAdvanced, setShowAdvanced] = useState(false)

	const setMsg = useCallback(
		(t: string) => {
			setStatus(t)
			onStatus?.(t)
		},
		[onStatus],
	)

	useEffect(() => {
		void sendHydroMapCommand("listPresets").then((r) => {
			const list = (r.result?.presets as Preset[] | undefined) ?? []
			if (list.length) {
				setPresets(list)
			}
		})
	}, [])

	const center = { lat: viewState.latitude, lon: viewState.longitude }
	const conus = isConus(center.lat, center.lon)

	const viewBbox = (): { minLon: number; minLat: number; maxLon: number; maxLat: number } => {
		const z = viewState.zoom ?? 8
		const deg = 360 / 2 ** (z + 1)
		return {
			minLon: center.lon - deg,
			minLat: center.lat - deg * 0.6,
			maxLon: center.lon + deg,
			maxLat: center.lat + deg * 0.6,
		}
	}

	const run = async (label: string, fn: () => Promise<{ ok: boolean; message?: string; error?: string }>, slow = false) => {
		setBusy(true)
		setMsg(slow ? `${label}… (first install may take several minutes via Google Drive)` : `${label}…`)
		try {
			const r = await fn()
			setMsg(r.ok ? r.message || `${label} done` : r.error || r.message || `${label} failed`)
		} catch (e) {
			setMsg(e instanceof Error ? e.message : String(e))
		} finally {
			setBusy(false)
		}
	}

	const loadRiversForView = async () => {
		setBusy(true)
		setMsg("Installing MERIT rivers for this view…")
		try {
			const ensure = await sendHydroMapCommand("meritEnsureBasin", {
				lat: center.lat,
				lon: center.lon,
				download: true,
			})
			if (!ensure.ok) {
				setMsg(ensure.error || ensure.message || "Install failed")
				return
			}
			setMsg("Adding rivers to map (clipped to view)…")
			const bb = viewBbox()
			const layers = await sendHydroMapCommand("meritLayers", {
				lat: center.lat,
				lon: center.lon,
				...bb,
				includeCatchments,
				includeLevel2: false,
			})
			setMsg(
				layers.ok
					? layers.message || "MERIT rivers loaded for this view"
					: layers.error || layers.message || "Could not add layers to map",
			)
		} catch (e) {
			setMsg(e instanceof Error ? e.message : String(e))
		} finally {
			setBusy(false)
		}
	}

	const loadHucsForView = async () => {
		if (!conus) {
			setMsg("WBD hydrologic units are available for CONUS only.")
			return
		}
		setBusy(true)
		setMsg(`Loading WBD HUC${hucLevel} for this view…`)
		try {
			const bb = viewBbox()
			const layers = await sendHydroMapCommand("wbdLayers", {
				lat: center.lat,
				lon: center.lon,
				...bb,
				hucLevel,
			})
			setMsg(
				layers.ok
					? layers.message || `WBD HUC${hucLevel} loaded for this view`
					: layers.error || layers.message || "Could not load HUC layers",
			)
		} catch (e) {
			setMsg(e instanceof Error ? e.message : String(e))
		} finally {
			setBusy(false)
		}
	}

	const btn: React.CSSProperties = {
		padding: "6px 10px",
		fontSize: 11,
		cursor: busy ? "wait" : "pointer",
		border: `1px solid ${border}`,
		borderRadius: 4,
		background: "transparent",
		color: fg,
		textAlign: "left",
		width: "100%",
	}

	const primaryBtn: React.CSSProperties = {
		...btn,
		fontWeight: 600,
		background: accentBg,
		border: `1px solid ${isDark ? "rgba(126,200,255,0.35)" : "rgba(14,99,156,0.35)"}`,
	}

	return (
		<div style={{ padding: 10, fontSize: 11, color: fg }}>
			<p style={{ margin: "0 0 4px", fontSize: 10, fontWeight: 600, color: muted, letterSpacing: 0.2 }}>
				Reference vectors
			</p>
			<p style={{ margin: "0 0 8px", color: muted, lineHeight: 1.45 }}>
				Adds <strong>MERIT river flowlines</strong> clipped to the map view (for snapping quick delineation outside
				CONUS). A small Pfaf index file may download in the background for lookup — it is not drawn on the map. For full
				MERIT-Basins accuracy, use <strong>Delineate with agent</strong>. Cache:{" "}
				<code style={{ fontSize: 10 }}>~/.aihydro/merit</code>.
			</p>

			<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
				<button
					disabled={busy}
					onClick={() => void loadRiversForView()}
					style={primaryBtn}
					title="Download MERIT rivers if needed, then add clipped vectors to the map"
					type="button">
					🌊 Load rivers for this view
				</button>
				<label
					style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: 10, color: muted, lineHeight: 1.4 }}
					title="Only shows polygons if cat_pfaf_*.shp is already on disk — Load rivers does not download catchments">
					<input
						checked={includeCatchments}
						disabled={busy}
						onChange={(e) => setIncludeCatchments(e.target.checked)}
						style={{ marginTop: 2 }}
						type="checkbox"
					/>
					<span>
						Show MERIT catchment polygons on map (if already installed under{" "}
						<code style={{ fontSize: 9 }}>~/.aihydro/merit/shp/merit_catchments</code>) — not downloaded by this
						button
					</span>
				</label>
				<button
					disabled={busy}
					onClick={() => setShowAdvanced((v) => !v)}
					style={{
						...btn,
						fontSize: 10,
						padding: "4px 8px",
						border: "none",
						textDecoration: "underline",
						opacity: 0.85,
					}}
					type="button">
					{showAdvanced ? "Hide advanced" : "Advanced options…"}
				</button>
			</div>

			{showAdvanced && (
				<div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
					<button
						disabled={busy}
						onClick={() =>
							run(
								"Install only (no map)",
								() =>
									sendHydroMapCommand("meritEnsureBasin", {
										lat: center.lat,
										lon: center.lon,
										download: true,
									}),
								true,
							)
						}
						style={btn}
						type="button">
						⬇ Install data only (no layers)
					</button>
					<button
						disabled={busy}
						onClick={() => {
							const bb = viewBbox()
							return run("Refresh map layers", () =>
								sendHydroMapCommand("meritLayers", {
									lat: center.lat,
									lon: center.lon,
									...bb,
									includeCatchments,
									includeLevel2: false,
								}),
							)
						}}
						style={btn}
						type="button">
						＋ Re-add layers (already installed)
					</button>
					{presets.length > 0 && (
						<div style={{ marginTop: 4 }}>
							<div style={{ fontSize: 10, fontWeight: 600, marginBottom: 6, color: muted }}>Region presets</div>
							<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
								{presets.map((p) => (
									<button
										disabled={busy}
										key={p.id}
										onClick={() =>
											run(
												`Install ${p.label}`,
												() =>
													sendHydroMapCommand("meritEnsureRegion", {
														preset: p.id,
														lat: center.lat,
														lon: center.lon,
														download: true,
													}),
												true,
											)
										}
										style={btn}
										type="button">
										⬇ {p.label}
									</button>
								))}
							</div>
						</div>
					)}
				</div>
			)}

			<div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${border}` }}>
				<p style={{ margin: "0 0 4px", fontSize: 10, fontWeight: 600, color: muted, letterSpacing: 0.2 }}>
					US hydrologic units (WBD)
				</p>
				<p style={{ margin: "0 0 8px", color: muted, lineHeight: 1.45 }}>
					National Map WBD boundaries for CONUS — HUC context without delineating a watershed.
				</p>
				<label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 10, color: muted, marginBottom: 8 }}>
					HUC level
					<select
						disabled={busy || !conus}
						onChange={(e) => setHucLevel(Number(e.target.value))}
						style={{ flex: 1, fontSize: 10, padding: "4px 6px" }}
						value={hucLevel}>
						<option value={8}>HUC8 (subbasin)</option>
						<option value={10}>HUC10 (watershed)</option>
						<option value={12}>HUC12 (subwatershed)</option>
						<option value={6}>HUC6 (basin)</option>
						<option value={4}>HUC4 (subregion)</option>
					</select>
				</label>
				<button
					disabled={busy || !conus}
					onClick={() => void loadHucsForView()}
					style={primaryBtn}
					title={conus ? "Add WBD polygons clipped to map view" : "Pan to CONUS to enable WBD layers"}
					type="button">
					🗺 Add HUCs for this view
				</button>
				{!conus && (
					<p style={{ margin: "6px 0 0", fontSize: 10, color: muted }}>Pan to the contiguous US to load WBD layers.</p>
				)}
			</div>

			{status && (
				<div
					style={{
						marginTop: 10,
						padding: "6px 8px",
						fontSize: 10,
						lineHeight: 1.4,
						borderRadius: 4,
						border: `1px solid ${border}`,
						color: muted,
					}}>
					{status}
				</div>
			)}
		</div>
	)
}

export default HydrographyPanel
