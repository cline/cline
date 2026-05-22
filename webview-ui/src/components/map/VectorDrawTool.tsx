import React, { useEffect, useMemo, useRef, useState } from "react"
import { fmtArea, fmtDist, type GeoPoint, lineLengthKm, polygonAreaKm2 } from "./geoMeasureMath"

export type VectorDrawMode = "polygon" | "line" | "point" | null

export interface CompletedVectorDraw {
	mode: "polygon" | "line" | "point"
	geojson: string
	areaKm2?: number
	lengthKm?: number
	pointCount: number
}

interface VectorDrawToolProps {
	mode: VectorDrawMode
	/** WGS84 hover from DeckGL onHover — aligned with clicks */
	hoverCoord: GeoPoint | null
	clickRef: React.MutableRefObject<((coord: [number, number]) => void) | null>
	mapStyle?: "dark" | "light"
	onGeometryChange?: (geojson: object | null) => void
	onComplete?: (result: CompletedVectorDraw) => void
	onCancel?: () => void
}

function buildGeoJson(mode: "polygon" | "line" | "point", points: GeoPoint[]): string {
	if (mode === "point" && points.length >= 1) {
		const p = points[0]
		return JSON.stringify({
			type: "Feature",
			properties: { name: "Point", source: "map_draw" },
			geometry: { type: "Point", coordinates: [p.lon, p.lat] },
		})
	}
	if (mode === "line" && points.length >= 2) {
		return JSON.stringify({
			type: "Feature",
			properties: { name: "Line", source: "map_draw" },
			geometry: {
				type: "LineString",
				coordinates: points.map((p) => [p.lon, p.lat]),
			},
		})
	}
	if (mode === "polygon" && points.length >= 3) {
		const ring = points.map((p) => [p.lon, p.lat] as [number, number])
		return JSON.stringify({
			type: "Feature",
			properties: { name: "Polygon", source: "map_draw" },
			geometry: {
				type: "Polygon",
				coordinates: [[...ring, ring[0]]],
			},
		})
	}
	return ""
}

export const VectorDrawTool: React.FC<VectorDrawToolProps> = ({
	mode,
	hoverCoord,
	clickRef,
	mapStyle = "dark",
	onGeometryChange,
	onComplete,
	onCancel,
}) => {
	const [points, setPoints] = useState<GeoPoint[]>([])
	const pointsRef = useRef<GeoPoint[]>([])
	pointsRef.current = points
	const onCompleteRef = useRef(onComplete)
	const onCancelRef = useRef(onCancel)
	useEffect(() => {
		onCompleteRef.current = onComplete
		onCancelRef.current = onCancel
	}, [onComplete, onCancel])

	useEffect(() => {
		setPoints([])
	}, [mode])

	useEffect(() => {
		if (!mode) {
			clickRef.current = null
			return
		}
		clickRef.current = (coord: [number, number]) => {
			const pt = { lon: coord[0], lat: coord[1] }
			if (mode === "point") {
				setPoints([pt])
				const geojson = buildGeoJson("point", [pt])
				onCompleteRef.current?.({
					mode: "point",
					geojson,
					pointCount: 1,
				})
				return
			}
			setPoints((prev) => [...prev, pt])
		}
		return () => {
			clickRef.current = null
		}
	}, [mode, clickRef])

	const tryFinish = () => {
		const pts = pointsRef.current
		if (!mode || mode === "point") {
			return
		}
		if (mode === "line" && pts.length >= 2) {
			const geojson = buildGeoJson("line", pts)
			onCompleteRef.current?.({
				mode: "line",
				geojson,
				lengthKm: lineLengthKm(pts),
				pointCount: pts.length,
			})
			return
		}
		if (mode === "polygon" && pts.length >= 3) {
			const geojson = buildGeoJson("polygon", pts)
			onCompleteRef.current?.({
				mode: "polygon",
				geojson,
				areaKm2: polygonAreaKm2(pts),
				pointCount: pts.length,
			})
		}
	}

	useEffect(() => {
		if (!mode) {
			return
		}
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				setPoints([])
				onCancelRef.current?.()
			}
			if (e.key === "Enter") {
				e.preventDefault()
				tryFinish()
			}
		}
		const handleDblClick = (e: MouseEvent) => {
			e.preventDefault()
			e.stopPropagation()
			tryFinish()
		}
		window.addEventListener("keydown", handleKeyDown)
		window.addEventListener("dblclick", handleDblClick, true)
		return () => {
			window.removeEventListener("keydown", handleKeyDown)
			window.removeEventListener("dblclick", handleDblClick, true)
		}
	}, [mode])

	const drawGeoJSON = useMemo(() => {
		if (!mode || points.length === 0) {
			return null
		}
		const pointFeatures = points.map((p, i) => ({
			type: "Feature" as const,
			geometry: { type: "Point" as const, coordinates: [p.lon, p.lat] as [number, number] },
			properties: { index: i + 1, _drawVertex: true },
		}))
		if (mode === "line" && points.length >= 1) {
			const coords = points.map((p) => [p.lon, p.lat] as [number, number])
			if (hoverCoord) {
				coords.push([hoverCoord.lon, hoverCoord.lat])
			}
			return {
				type: "FeatureCollection" as const,
				features: [
					{
						type: "Feature" as const,
						geometry: { type: "LineString" as const, coordinates: coords },
						properties: { _drawLine: true },
					},
					...pointFeatures,
				],
			}
		}
		if (mode === "polygon" && points.length >= 1) {
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
							properties: { _drawPolygon: true },
						},
						...pointFeatures,
					],
				}
			}
		}
		return { type: "FeatureCollection" as const, features: pointFeatures }
	}, [points, hoverCoord, mode])

	useEffect(() => {
		onGeometryChange?.(drawGeoJSON)
	}, [drawGeoJSON, onGeometryChange])

	const stats = useMemo(() => {
		if (mode === "polygon" && points.length >= 3) {
			return fmtArea(polygonAreaKm2(points))
		}
		if (mode === "line" && points.length >= 2) {
			return fmtDist(lineLengthKm(points))
		}
		return null
	}, [points, mode])

	if (!mode) {
		return null
	}

	const isDark = mapStyle === "dark"
	const fg = isDark ? "rgba(255,255,255,0.9)" : "rgba(0,0,0,0.9)"
	const accent = "#2d9f6f"

	const title = mode === "polygon" ? "Draw polygon" : mode === "line" ? "Draw line" : "Place point"

	return (
		<div
			style={{
				position: "absolute",
				top: 12,
				left: 12,
				zIndex: 4,
				padding: "10px 14px",
				background: isDark ? "rgba(20,20,28,0.92)" : "rgba(252,252,252,0.93)",
				border: `1px solid ${isDark ? "rgba(45,159,111,0.5)" : "rgba(45,159,111,0.35)"}`,
				borderRadius: 6,
				boxShadow: "0 2px 10px rgba(0,0,0,0.30)",
				color: fg,
				fontFamily: "var(--vscode-font-family, system-ui, sans-serif)",
				fontSize: 12,
				pointerEvents: "none",
				minWidth: 240,
				maxWidth: 300,
			}}>
			<div style={{ fontWeight: 600, marginBottom: 4, color: accent }}>✏️ {title}</div>
			<div style={{ fontSize: 10, opacity: 0.8, marginBottom: 8, lineHeight: 1.5 }}>
				{mode === "point"
					? "Click once on the map to place a point. ESC to cancel."
					: "Click vertices on the map. Enter or double-click to finish. ESC to cancel."}
			</div>
			{stats && <div style={{ fontSize: 15, fontWeight: 700, color: accent, marginBottom: 6 }}>{stats}</div>}
			<div style={{ fontSize: 10, opacity: 0.65 }}>
				{points.length} vertex{points.length === 1 ? "" : "es"}
				{mode === "polygon" && points.length >= 1 && points.length < 3 ? " (need 3+ to finish)" : ""}
				{mode === "line" && points.length === 1 ? " (need 2+ to finish)" : ""}
			</div>
		</div>
	)
}

export default VectorDrawTool
