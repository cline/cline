import React, { useEffect, useMemo, useRef, useState } from "react"
import { fmtArea, fmtDist, type GeoPoint, haversineKm, lineLengthKm, polygonAreaKm2 } from "./geoMeasureMath"

export type MeasureMode = "distance" | "area" | null

interface MeasureToolProps {
	mode: MeasureMode
	/** WGS84 from DeckGL onHover — same frame as map clicks */
	hoverCoord: GeoPoint | null
	clickRef: React.MutableRefObject<((coord: [number, number]) => void) | null>
	mapStyle?: "dark" | "light"
	onClose?: () => void
	onGeometryChange?: (geojson: any) => void
}

export const MeasureTool: React.FC<MeasureToolProps> = ({
	mode,
	hoverCoord,
	clickRef,
	mapStyle = "dark",
	onClose,
	onGeometryChange,
}) => {
	const [points, setPoints] = useState<GeoPoint[]>([])
	const isActive = mode !== null
	const isDark = mapStyle === "dark"
	const fg = isDark ? "rgba(255,255,255,0.9)" : "rgba(0,0,0,0.9)"
	const accent = "#0e639c"
	const pointsRef = useRef<GeoPoint[]>([])
	pointsRef.current = points
	const onCloseRef = useRef(onClose)
	useEffect(() => {
		onCloseRef.current = onClose
	}, [onClose])

	useEffect(() => {
		setPoints([])
	}, [mode])

	useEffect(() => {
		if (!isActive) {
			clickRef.current = null
			return
		}
		clickRef.current = (coord: [number, number]) => {
			setPoints((prev) => [...prev, { lon: coord[0], lat: coord[1] }])
		}
		return () => {
			clickRef.current = null
		}
	}, [isActive, clickRef])

	useEffect(() => {
		if (!isActive || !mode) {
			return
		}

		const finish = () => {
			const pts = pointsRef.current
			if (mode === "area" && pts.length >= 3) {
				setPoints([])
				return
			}
			if (mode === "distance" && pts.length >= 2) {
				setPoints([])
			}
		}

		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				setPoints([])
				onCloseRef.current?.()
			}
			if (e.key === "Enter") {
				e.preventDefault()
				finish()
			}
		}
		const handleDblClick = (e: MouseEvent) => {
			e.preventDefault()
			e.stopPropagation()
			finish()
		}
		window.addEventListener("keydown", handleKeyDown)
		window.addEventListener("dblclick", handleDblClick, true)
		return () => {
			window.removeEventListener("keydown", handleKeyDown)
			window.removeEventListener("dblclick", handleDblClick, true)
		}
	}, [isActive, mode])

	const measureGeoJSON = useMemo(() => {
		if (!mode || points.length === 0) {
			return null
		}
		const pointFeatures = points.map((p, i) => ({
			type: "Feature" as const,
			geometry: { type: "Point" as const, coordinates: [p.lon, p.lat] as [number, number] },
			properties: { index: i + 1, _measureVertex: true },
		}))
		if (mode === "distance" && points.length >= 1) {
			const coords = points.map((p) => [p.lon, p.lat] as [number, number])
			if (hoverCoord) {
				coords.push([hoverCoord.lon, hoverCoord.lat])
			}
			if (coords.length >= 2) {
				return {
					type: "FeatureCollection" as const,
					features: [
						{
							type: "Feature" as const,
							geometry: { type: "LineString" as const, coordinates: coords },
							properties: { _measureLine: true },
						},
						...pointFeatures,
					],
				}
			}
		}
		if (mode === "area" && points.length >= 1) {
			const ring = points.map((p) => [p.lon, p.lat] as [number, number])
			if (hoverCoord) {
				ring.push([hoverCoord.lon, hoverCoord.lat])
			}
			if (ring.length >= 2) {
				return {
					type: "FeatureCollection" as const,
					features: [
						{
							type: "Feature" as const,
							geometry: {
								type: "Polygon" as const,
								coordinates: [[...ring, ring[0]]],
							},
							properties: { _measureArea: true },
						},
						...pointFeatures,
					],
				}
			}
		}
		return { type: "FeatureCollection" as const, features: pointFeatures }
	}, [points, hoverCoord, mode])

	useEffect(() => {
		onGeometryChange?.(measureGeoJSON)
	}, [measureGeoJSON, onGeometryChange])

	const runningTotal = useMemo(() => {
		if (mode === "distance" && points.length >= 2) {
			return fmtDist(lineLengthKm(points))
		}
		if (mode === "area" && points.length >= 3) {
			return fmtArea(polygonAreaKm2(points))
		}
		if (mode === "distance" && points.length === 1 && hoverCoord) {
			return fmtDist(haversineKm(points[0], hoverCoord))
		}
		return null
	}, [points, hoverCoord, mode])

	if (!isActive) {
		return null
	}

	return (
		<div
			style={{
				position: "absolute",
				top: 12,
				left: 12,
				zIndex: 4,
				padding: "10px 14px",
				background: isDark ? "rgba(20,20,28,0.92)" : "rgba(252,252,252,0.93)",
				border: `1px solid ${isDark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.14)"}`,
				borderRadius: 6,
				boxShadow: "0 2px 10px rgba(0,0,0,0.30)",
				color: fg,
				fontFamily: "var(--vscode-font-family, system-ui, sans-serif)",
				fontSize: 12,
				pointerEvents: "none",
				minWidth: 220,
				maxWidth: 280,
			}}>
			<div style={{ fontWeight: 600, marginBottom: 4, fontSize: 12 }}>
				{mode === "distance" ? "📏 Distance measure" : "📐 Area measure"}
			</div>
			<div style={{ fontSize: 10, opacity: 0.75, marginBottom: 8, lineHeight: 1.5 }}>
				Temporary measurement only — not saved. Enter or double-click to finish. ESC to cancel.
			</div>
			{runningTotal && <div style={{ fontSize: 15, fontWeight: 700, color: accent, marginBottom: 6 }}>{runningTotal}</div>}
			{points.length === 0 && (
				<div style={{ fontSize: 11, opacity: 0.6, fontStyle: "italic" }}>Click to start measuring…</div>
			)}
			<div style={{ marginTop: 8, fontSize: 10, opacity: 0.65 }}>
				{points.length} point{points.length === 1 ? "" : "s"}
			</div>
		</div>
	)
}

export default MeasureTool
