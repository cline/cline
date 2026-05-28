import type { MapLayer } from "@shared/proto/cline/map"
import React, { useMemo } from "react"
import { type CursorRasterReading, gradientForLegend, type LegendSpec, parseLayerLegend } from "./mapLayerAdapters"

const fmtValue = (v: number): string => {
	if (!Number.isFinite(v)) {
		return "—"
	}
	const abs = Math.abs(v)
	if (abs >= 1000) {
		return v.toFixed(0)
	}
	if (abs >= 10) {
		return v.toFixed(2)
	}
	if (abs >= 1) {
		return v.toFixed(3)
	}
	return v.toPrecision(3)
}

interface MapLegendProps {
	layers: MapLayer[]
	visibleLayerIds: Set<string>
	mapStyle: string
	cursorReading: CursorRasterReading | null
}

/**
 * Legend for the topmost visible raster or gee_tile layer.
 * Uses metadata.legend when present; falls back to raster colormap conventions.
 */
export const MapLegend: React.FC<MapLegendProps> = ({ layers, visibleLayerIds, mapStyle, cursorReading }) => {
	const meritRiverLayer = useMemo(
		() =>
			layers.find(
				(l) =>
					visibleLayerIds.has(l.id) &&
					(l.metadata?.merit_layer === "rivers" ||
						`${l.id} ${l.name}`.toLowerCase().includes("merit-rivers") ||
						`${l.id} ${l.name}`.toLowerCase().includes("merit rivers")),
			),
		[layers, visibleLayerIds],
	)

	const legendLayer = useMemo(() => {
		const candidates = layers.filter(
			(l) => (l.layerType === "raster" || l.layerType === "gee_tile") && visibleLayerIds.has(l.id),
		)
		if (candidates.length === 0) {
			return null
		}
		if (cursorReading) {
			const hit = candidates.find((l) => l.id === cursorReading.layerId)
			if (hit) {
				return hit
			}
		}
		return candidates[candidates.length - 1]
	}, [layers, visibleLayerIds, cursorReading])

	const spec = useMemo(() => (legendLayer ? parseLayerLegend(legendLayer) : undefined), [legendLayer])

	const isDark = mapStyle === "dark"
	const bg = isDark ? "rgba(18,18,26,0.88)" : "rgba(252,252,252,0.90)"
	const fg = isDark ? "rgba(255,255,255,0.85)" : "rgba(0,0,0,0.85)"
	const bdClr = isDark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.14)"
	const tickColor = isDark ? "#ffffff" : "#000000"

	if (meritRiverLayer && !legendLayer) {
		return <MeritRiverLegend bdClr={bdClr} bg={bg} fg={fg} />
	}

	if (!legendLayer || !spec) {
		return null
	}

	if (spec.type === "categorical") {
		return <CategoricalLegend bdClr={bdClr} bg={bg} fg={fg} layerName={legendLayer.name} spec={spec} />
	}

	const minRaw =
		cursorReading?.layerId === legendLayer.id
			? cursorReading.min
			: (spec.min ?? (legendLayer.metadata?.min ? parseFloat(legendLayer.metadata.min) : NaN))
	const maxRaw =
		cursorReading?.layerId === legendLayer.id
			? cursorReading.max
			: (spec.max ?? (legendLayer.metadata?.max ? parseFloat(legendLayer.metadata.max) : NaN))
	const gradient = gradientForLegend(spec)
	const showTick =
		cursorReading &&
		cursorReading.layerId === legendLayer.id &&
		Number.isFinite(minRaw) &&
		Number.isFinite(maxRaw) &&
		maxRaw > minRaw
	const tickPct = showTick ? Math.max(0, Math.min(1, (cursorReading.value - minRaw) / (maxRaw - minRaw))) : 0

	return (
		<div
			style={{
				position: "absolute",
				bottom: 42,
				left: 12,
				zIndex: 4,
				padding: "6px 10px 5px",
				background: bg,
				border: `1px solid ${bdClr}`,
				borderRadius: 5,
				boxShadow: "0 1px 5px rgba(0,0,0,0.28)",
				fontFamily: "var(--vscode-font-family, system-ui, sans-serif)",
				fontSize: 10,
				color: fg,
				minWidth: 170,
				maxWidth: 240,
				pointerEvents: "none",
			}}>
			<div
				style={{
					marginBottom: 4,
					fontSize: 10,
					opacity: 0.72,
					overflow: "hidden",
					textOverflow: "ellipsis",
					whiteSpace: "nowrap",
				}}>
				{spec.title || legendLayer.name}
			</div>
			<div style={{ position: "relative", marginBottom: 3 }}>
				<div style={{ height: 10, background: gradient, borderRadius: 2, border: `1px solid ${bdClr}` }} />
				{showTick && (
					<>
						<div
							style={{
								position: "absolute",
								top: -2,
								left: `calc(${(tickPct * 100).toFixed(2)}% - 1px)`,
								width: 2,
								height: 14,
								background: tickColor,
								boxShadow: "0 0 0 1px rgba(0,0,0,0.55)",
								borderRadius: 1,
							}}
						/>
					</>
				)}
			</div>
			<div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, opacity: 0.78 }}>
				<span>{Number.isFinite(minRaw) ? fmtValue(minRaw) : "min"}</span>
				<span>{Number.isFinite(maxRaw) ? fmtValue(maxRaw) : "max"}</span>
			</div>
			{spec.units && <div style={{ fontSize: 9, opacity: 0.65, marginTop: 2 }}>{spec.units}</div>}
			{showTick && (
				<div style={{ display: "flex", gap: 6, marginTop: 4, alignItems: "baseline" }}>
					<span style={{ fontSize: 9, opacity: 0.65 }}>cursor</span>
					<span style={{ fontSize: 12, fontWeight: 600 }}>{fmtValue(cursorReading.value)}</span>
				</div>
			)}
		</div>
	)
}

const MeritRiverLegend: React.FC<{ bg: string; fg: string; bdClr: string }> = ({ bg, fg, bdClr }) => (
	<div
		style={{
			position: "absolute",
			bottom: 42,
			left: 12,
			zIndex: 4,
			padding: "6px 10px",
			background: bg,
			border: `1px solid ${bdClr}`,
			borderRadius: 5,
			boxShadow: "0 1px 5px rgba(0,0,0,0.28)",
			fontFamily: "var(--vscode-font-family, system-ui, sans-serif)",
			fontSize: 10,
			color: fg,
			minWidth: 160,
			pointerEvents: "none",
		}}>
		<div style={{ marginBottom: 6, opacity: 0.75 }}>MERIT rivers</div>
		{[
			{ label: "minor drainage", color: "#7dd3fc", width: 2 },
			{ label: "medium river", color: "#0ea5e9", width: 4 },
			{ label: "major river", color: "#0c4a6e", width: 7 },
		].map((item) => (
			<div key={item.label} style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}>
				<span
					style={{
						width: 36,
						height: item.width,
						borderRadius: 2,
						background: item.color,
						boxShadow: "0 0 0 1px rgba(0,0,0,0.18)",
						flexShrink: 0,
					}}
				/>
				<span style={{ opacity: 0.78 }}>{item.label}</span>
			</div>
		))}
		<div style={{ marginTop: 4, fontSize: 9, opacity: 0.62 }}>width/color by stream order or upstream area</div>
	</div>
)

const CategoricalLegend: React.FC<{
	spec: Extract<LegendSpec, { type: "categorical" }>
	layerName: string
	bg: string
	fg: string
	bdClr: string
}> = ({ spec, layerName, bg, fg, bdClr }) => (
	<div
		style={{
			position: "absolute",
			bottom: 42,
			left: 12,
			zIndex: 4,
			padding: "6px 10px",
			background: bg,
			border: `1px solid ${bdClr}`,
			borderRadius: 5,
			fontSize: 10,
			color: fg,
			maxWidth: 220,
			pointerEvents: "none",
		}}>
		<div style={{ marginBottom: 6, opacity: 0.75 }}>{spec.title || layerName}</div>
		{spec.classes.slice(0, 8).map((c) => (
			<div key={String(c.value)} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
				<span
					style={{
						width: 12,
						height: 12,
						borderRadius: 2,
						background: c.color,
						border: `1px solid ${bdClr}`,
						flexShrink: 0,
					}}
				/>
				<span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.label}</span>
			</div>
		))}
	</div>
)

export default MapLegend
