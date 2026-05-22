import type { MapViewState } from "@deck.gl/core"
import React, { useMemo, useState } from "react"

interface MapStatusBarProps {
	cursorCoord: { lon: number; lat: number } | null
	viewState: MapViewState
	mapStyle?: string
}

/**
 * Compute scale-bar length and label from current zoom + cursor latitude.
 *
 * Uses the standard Web-Mercator ground-resolution formula:
 *     metersPerPixel = 156543.03392 * cos(lat) / 2^zoom
 *
 * Picks a "nice" round length close to ~120 pixels of screen width.
 */
const computeScaleBar = (zoom: number, lat: number): { widthPx: number; label: string } => {
	const metersPerPixel = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom
	const targetMeters = metersPerPixel * 120
	const niceSteps = [
		1, 2, 5, 10, 20, 50, 100, 200, 500, 1_000, 2_000, 5_000, 10_000, 20_000, 50_000, 100_000, 200_000, 500_000, 1_000_000,
		2_000_000, 5_000_000,
	]
	const stepMeters = niceSteps.find((s) => s > targetMeters) ?? niceSteps[niceSteps.length - 1]
	const widthPx = Math.max(20, Math.min(300, stepMeters / metersPerPixel))
	const label = stepMeters >= 1000 ? `${stepMeters / 1000} km` : `${stepMeters} m`
	return { widthPx, label }
}

type CoordFormat = "decimal" | "dms" | "utm"

const formatDecimal = (lon: number, lat: number): string => {
	const lonHem = lon >= 0 ? "E" : "W"
	const latHem = lat >= 0 ? "N" : "S"
	return `${Math.abs(lat).toFixed(4)}°${latHem}, ${Math.abs(lon).toFixed(4)}°${lonHem}`
}

const toDMS = (deg: number, isLat: boolean): string => {
	const abs = Math.abs(deg)
	const d = Math.floor(abs)
	const m = Math.floor((abs - d) * 60)
	const s = ((abs - d) * 60 - m) * 60
	const dir = isLat ? (deg >= 0 ? "N" : "S") : deg >= 0 ? "E" : "W"
	return `${d}°${m.toString().padStart(2, "0")}'${s.toFixed(1).padStart(4, "0")}"${dir}`
}

const formatDMS = (lon: number, lat: number): string => {
	return `${toDMS(lat, true)}  ${toDMS(lon, false)}`
}

/** UTM zone from longitude (1-60). */
const utmZone = (lon: number): number => Math.floor((lon + 180) / 6) + 1

const formatUTM = (lon: number, lat: number): string => {
	// Simplified UTM approximation — not rigorous but good enough for status bar
	const zone = utmZone(lon)
	const k0 = 0.9996
	const a = 6378137 // WGS84 major axis
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

const formatLatLon = (lon: number, lat: number, fmt: CoordFormat): string => {
	switch (fmt) {
		case "dms":
			return formatDMS(lon, lat)
		case "utm":
			return formatUTM(lon, lat)
		default:
			return formatDecimal(lon, lat)
	}
}

export const MapStatusBar: React.FC<MapStatusBarProps> = ({ cursorCoord, viewState, mapStyle = "dark" }) => {
	const [coordFormat, setCoordFormat] = useState<CoordFormat>("decimal")
	const isDark = mapStyle === "dark"
	const { widthPx, label } = useMemo(
		() => computeScaleBar(viewState.zoom, cursorCoord?.lat ?? viewState.latitude),
		[viewState.zoom, viewState.latitude, cursorCoord?.lat],
	)

	const fg = isDark ? "rgba(255,255,255,0.92)" : "rgba(0,0,0,0.85)"
	const bg = isDark ? "rgba(20,20,28,0.70)" : "rgba(255,255,255,0.85)"
	const border = isDark ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.18)"

	const cycleFormat = () => {
		setCoordFormat((f) => (f === "decimal" ? "dms" : f === "dms" ? "utm" : "decimal"))
	}

	return (
		<>
			{/* Scale bar — bottom left */}
			<div
				style={{
					position: "absolute",
					bottom: 8,
					left: 10,
					zIndex: 5,
					padding: "3px 8px",
					background: bg,
					color: fg,
					border: `1px solid ${border}`,
					borderRadius: 3,
					fontSize: 11,
					fontFamily: "var(--vscode-font-family, system-ui, sans-serif)",
					display: "flex",
					alignItems: "center",
					gap: 8,
					pointerEvents: "none",
					userSelect: "none",
				}}>
				<div
					style={{
						width: widthPx,
						height: 8,
						borderLeft: `2px solid ${fg}`,
						borderRight: `2px solid ${fg}`,
						borderBottom: `2px solid ${fg}`,
					}}
				/>
				<span style={{ fontVariantNumeric: "tabular-nums" }}>{label}</span>
			</div>

			{/* Coordinate readout — bottom right */}
			<div
				style={{
					position: "absolute",
					bottom: 8,
					right: 10,
					zIndex: 5,
					padding: "3px 8px",
					background: bg,
					color: fg,
					border: `1px solid ${border}`,
					borderRadius: 3,
					fontSize: 11,
					fontFamily: "var(--vscode-editor-font-family, ui-monospace, monospace)",
					fontVariantNumeric: "tabular-nums",
					pointerEvents: "auto",
					userSelect: "none",
					minWidth: 180,
					textAlign: "right",
					cursor: "pointer",
				}}>
				{cursorCoord ? (
					<button
						onClick={cycleFormat}
						style={{
							background: "transparent",
							border: "none",
							color: fg,
							cursor: "pointer",
							fontFamily: "inherit",
							fontSize: "inherit",
							fontVariantNumeric: "inherit",
							padding: 0,
							margin: 0,
						}}
						title="Click to cycle coordinate format: decimal → DMS → UTM">
						{formatLatLon(cursorCoord.lon, cursorCoord.lat, coordFormat)}
					</button>
				) : (
					`z ${viewState.zoom.toFixed(2)}`
				)}
			</div>
		</>
	)
}

export default MapStatusBar
