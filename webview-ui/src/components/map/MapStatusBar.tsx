import type { MapViewState } from "@deck.gl/core"
import React, { useMemo } from "react"

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

const formatLatLon = (lon: number, lat: number): string => {
	const lonHem = lon >= 0 ? "E" : "W"
	const latHem = lat >= 0 ? "N" : "S"
	return `${Math.abs(lat).toFixed(4)}°${latHem}, ${Math.abs(lon).toFixed(4)}°${lonHem}`
}

export const MapStatusBar: React.FC<MapStatusBarProps> = ({ cursorCoord, viewState, mapStyle = "dark" }) => {
	const isDark = mapStyle === "dark"
	const { widthPx, label } = useMemo(
		() => computeScaleBar(viewState.zoom, cursorCoord?.lat ?? viewState.latitude),
		[viewState.zoom, viewState.latitude, cursorCoord?.lat],
	)

	const fg = isDark ? "rgba(255,255,255,0.92)" : "rgba(0,0,0,0.85)"
	const bg = isDark ? "rgba(20,20,28,0.70)" : "rgba(255,255,255,0.85)"
	const border = isDark ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.18)"

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
					pointerEvents: "none",
					userSelect: "none",
					minWidth: 180,
					textAlign: "right",
				}}>
				{cursorCoord ? formatLatLon(cursorCoord.lon, cursorCoord.lat) : `z ${viewState.zoom.toFixed(2)}`}
			</div>
		</>
	)
}

export default MapStatusBar
