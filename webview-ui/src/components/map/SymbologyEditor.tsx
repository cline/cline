/**
 * SymbologyEditor — per-layer style editor (QGIS Layer Properties → Symbology, simplified).
 *
 * Vector layers: fill color + opacity, stroke color + width.
 * Raster layers: colormap dropdown + opacity slider.
 *
 * Edits are pushed back through MapService.addMapLayer (overwrite by id).
 */

import { AddMapLayerRequest, type MapLayer, MapLayerStyle } from "@shared/proto/cline/map"
import React, { useMemo, useState } from "react"
import { PLATFORM_CONFIG } from "../../config/platform.config"
import { MapServiceClient } from "../../services/grpc-client"
import { loadFile } from "./formats/loadFile"
import { dataUrlToImage, rasterCache } from "./formats/rasterCache"
import type { RasterLayerSpec } from "./formats/types"
import { deriveLayerIntelligence } from "./layerIntelligence"

interface SymbologyEditorProps {
	layer: MapLayer
	onClose: () => void
	mapStyle?: string
}

const COLORMAPS = ["viridis", "viridis_r", "YlOrRd", "Blues", "RdYlGn", "plasma", "magma", "cividis"]

function newRequestId(): string {
	return `fileuri-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function resolveFileUri(filePath: string): Promise<{ uri: string; name: string }> {
	const requestId = newRequestId()
	return new Promise((resolve, reject) => {
		const timeout = window.setTimeout(() => {
			window.removeEventListener("message", onMessage)
			reject(new Error("Timed out resolving GeoTIFF path"))
		}, 30_000)
		const onMessage = (event: MessageEvent) => {
			const data = event.data
			if (!data || data.type !== "aihydro-resolve-file-uri-result" || data.requestId !== requestId) {
				return
			}
			window.clearTimeout(timeout)
			window.removeEventListener("message", onMessage)
			if (data.ok && typeof data.uri === "string") {
				resolve({ uri: data.uri, name: data.name ?? filePath.split("/").pop() ?? "raster.tif" })
			} else {
				reject(new Error(data.error ?? "Could not resolve GeoTIFF path"))
			}
		}
		window.addEventListener("message", onMessage)
		PLATFORM_CONFIG.postMessage({ type: "aihydro-resolve-file-uri", requestId, path: filePath })
	})
}

function rasterSourceCandidates(layer: MapLayer): string[] {
	const meta = layer.metadata ?? {}
	const out = new Set<string>()
	for (const key of ["raster_source_path", "source_raster_path", "source_tif_path", "twi_raster_path"]) {
		if (meta[key]) {
			out.add(meta[key])
		}
	}
	const rasterPath = meta.raster_path
	if (rasterPath) {
		if (/_tile\.png$/i.test(rasterPath)) {
			out.add(rasterPath.replace(/_tile\.png$/i, ".tif"))
		}
		if (/_overlay\.png$/i.test(rasterPath)) {
			out.add(rasterPath.replace(/_overlay\.png$/i, ".tif"))
		}
	}
	const sessionId = meta.session_id
	if (sessionId && /^TWI[:\s]/i.test(layer.name || layer.id)) {
		out.add(`~/.aihydro/sessions/${sessionId}/outputs/twi_${sessionId}.tif`)
	}
	return Array.from(out)
}

export const SymbologyEditor: React.FC<SymbologyEditorProps> = ({ layer, onClose, mapStyle = "dark" }) => {
	const isRaster = layer.layerType === "raster"
	const [, setCacheVersion] = useState(0)
	const rasterEntry = isRaster ? rasterCache.get(layer.id) : undefined
	const canRecolorRaster = Boolean(rasterEntry?.rawPixels)
	const intelligence = deriveLayerIntelligence(layer, { rawRasterValuesAvailable: canRecolorRaster })
	const sourceCandidates = isRaster ? rasterSourceCandidates(layer) : []
	const isDark = mapStyle === "dark"
	const fg = isDark ? "var(--vscode-foreground, #ddd)" : "var(--vscode-foreground, #222)"
	const bg = isDark ? "rgba(20,20,28,0.97)" : "rgba(248,248,250,0.97)"
	const border = isDark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.14)"
	const subtle = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)"

	const [fillColor, setFillColor] = useState<string>(layer.style?.fillColor ?? "#0066CC")
	const [fillOpacity, setFillOpacity] = useState<number>(layer.style?.fillOpacity ?? 0.4)
	const [strokeColor, setStrokeColor] = useState<string>(layer.style?.strokeColor ?? layer.style?.color ?? "#003399")
	const [strokeWidth, setStrokeWidth] = useState<number>(layer.style?.strokeWidth ?? layer.style?.weight ?? 2)
	const [rasterOpacity, setRasterOpacity] = useState<number>(parseFloat(layer.metadata?.raster_opacity ?? "0.85"))
	const [rasterColormap, setRasterColormap] = useState<string>(layer.metadata?.raster_colormap ?? "viridis")
	const dataMin = rasterEntry?.rawPixels?.min ?? 0
	const dataMax = rasterEntry?.rawPixels?.max ?? 1
	const [stretchMin, setStretchMin] = useState<number>(
		layer.metadata?.raster_stretch_min ? parseFloat(layer.metadata.raster_stretch_min) : dataMin,
	)
	const [stretchMax, setStretchMax] = useState<number>(
		layer.metadata?.raster_stretch_max ? parseFloat(layer.metadata.raster_stretch_max) : dataMax,
	)
	const [busy, setBusy] = useState(false)
	const [hydrating, setHydrating] = useState(false)
	const [hydrateError, setHydrateError] = useState<string | null>(null)

	const hydrateRasterPixels = async () => {
		setHydrating(true)
		setHydrateError(null)
		try {
			let lastError: unknown
			for (const candidate of sourceCandidates) {
				try {
					const resolved = await resolveFileUri(candidate)
					const response = await fetch(resolved.uri)
					if (!response.ok) {
						throw new Error(`HTTP ${response.status}`)
					}
					const blob = await response.blob()
					const file = new File([blob], resolved.name)
					const spec = (await loadFile(file, { idOverride: layer.id, nameOverride: layer.name })) as RasterLayerSpec
					if (spec.kind !== "raster" || !spec.rawPixels) {
						throw new Error("Source did not load as a raw-pixel raster")
					}
					const image = await dataUrlToImage(spec.dataUrl)
					rasterCache.set(layer.id, {
						image,
						bounds: spec.bounds,
						colormap: spec.colormap ?? "viridis",
						rawPixels: spec.rawPixels,
					})
					await MapServiceClient.addMapLayer(
						AddMapLayerRequest.create({
							layer: {
								...layer,
								metadata: {
									...(layer.metadata ?? {}),
									...(spec.metadata ?? {}),
									raster_data_url: spec.dataUrl,
									raster_bounds: JSON.stringify(spec.bounds),
									raster_opacity: String(rasterOpacity),
									raster_colormap: spec.colormap ?? rasterColormap,
									raster_recolorable: "true",
									raster_source_path: candidate,
								},
							} as any,
						}),
					)
					setRasterColormap(spec.colormap ?? rasterColormap)
					setCacheVersion((value) => value + 1)
					return
				} catch (err) {
					lastError = err
				}
			}
			throw lastError ?? new Error("No source GeoTIFF path is available")
		} catch (err) {
			setHydrateError(err instanceof Error ? err.message : String(err))
		} finally {
			setHydrating(false)
		}
	}

	const apply = async () => {
		setBusy(true)
		try {
			if (isRaster) {
				const next = {
					...layer,
					metadata: {
						...(layer.metadata ?? {}),
						raster_opacity: String(rasterOpacity),
						...(canRecolorRaster ? { raster_colormap: rasterColormap } : {}),
						...(canRecolorRaster
							? { raster_stretch_min: String(stretchMin), raster_stretch_max: String(stretchMax) }
							: {}),
					},
				}
				await MapServiceClient.addMapLayer(AddMapLayerRequest.create({ layer: next as any }))
			} else {
				const style = MapLayerStyle.create({
					fillColor,
					fillOpacity,
					strokeColor,
					color: strokeColor,
					strokeWidth,
					weight: strokeWidth,
					opacity: 1,
				})
				const next = {
					...layer,
					style,
					metadata: {
						...(layer.metadata ?? {}),
						symbology_user_override: "true",
					},
				}
				await MapServiceClient.addMapLayer(AddMapLayerRequest.create({ layer: next as any }))
			}
			onClose()
		} catch (err) {
			console.error("Failed to apply symbology:", err)
		} finally {
			setBusy(false)
		}
	}

	return (
		<div
			style={{
				marginTop: 6,
				padding: 8,
				background: subtle,
				border: `1px dashed ${border}`,
				borderRadius: 4,
				fontSize: 11,
				color: fg,
				display: "flex",
				flexDirection: "column",
				gap: 8,
			}}>
			<div style={{ display: "flex", alignItems: "center", gap: 6 }}>
				<span style={{ fontWeight: 600 }}>Symbology</span>
				<div style={{ flex: 1 }} />
				<button
					onClick={onClose}
					style={{
						background: "transparent",
						border: `1px solid ${border}`,
						color: fg,
						borderRadius: 3,
						padding: "2px 6px",
						cursor: "pointer",
						fontSize: 11,
					}}
					type="button">
					✕
				</button>
			</div>

			{isRaster ? (
				<>
					<div
						style={{
							padding: "5px 7px",
							borderRadius: 4,
							background: canRecolorRaster ? "rgba(43, 183, 117, 0.10)" : "rgba(255, 190, 80, 0.10)",
							color: canRecolorRaster ? "#6ee7a8" : "var(--vscode-editorWarning-foreground, #cca700)",
							lineHeight: 1.35,
						}}>
						<strong>{intelligence.statusLabel}</strong>
						<div style={{ color: fg, opacity: 0.72, marginTop: 2 }}>{intelligence.statusDetail}</div>
					</div>
					{canRecolorRaster && rasterEntry?.rawPixels && (
						<RasterHistogram
							border={border}
							colormap={rasterColormap}
							fg={fg}
							onStretchChange={(lo, hi) => {
								setStretchMin(lo)
								setStretchMax(hi)
							}}
							rawPixels={rasterEntry.rawPixels}
							stretchMax={stretchMax}
							stretchMin={stretchMin}
						/>
					)}
					<Row label="Colormap">
						<select
							disabled={!canRecolorRaster}
							onChange={(e) => setRasterColormap(e.target.value)}
							style={selectStyle(fg, border, bg, !canRecolorRaster)}
							value={rasterColormap}>
							{COLORMAPS.map((c) => (
								<option key={c} value={c}>
									{c}
								</option>
							))}
						</select>
					</Row>
					{!canRecolorRaster ? (
						<div style={{ color: fg, fontSize: 11, lineHeight: 1.35, opacity: 0.72 }}>
							Opacity is available now. Load raster values to enable colormap editing, value probing, and
							analysis-ready map styling.
							{sourceCandidates.length > 0 ? (
								<div style={{ marginTop: 6 }}>
									<button
										disabled={hydrating}
										onClick={hydrateRasterPixels}
										style={{
											padding: "4px 8px",
											fontSize: 11,
											background: "var(--vscode-button-secondaryBackground, rgba(255,255,255,0.08))",
											color: fg,
											border: `1px solid ${border}`,
											borderRadius: 3,
											cursor: hydrating ? "not-allowed" : "pointer",
										}}
										type="button">
										{hydrating ? "Loading raster values..." : "Load raster values"}
									</button>
								</div>
							) : null}
							{hydrateError ? <div style={{ marginTop: 5, color: "#ff6b6b" }}>{hydrateError}</div> : null}
						</div>
					) : null}
					<Row label="Opacity">
						<input
							max={1}
							min={0}
							onChange={(e) => setRasterOpacity(parseFloat(e.target.value))}
							step={0.05}
							style={{ flex: 1 }}
							type="range"
							value={rasterOpacity}
						/>
						<span style={{ minWidth: 32, textAlign: "right" }}>{rasterOpacity.toFixed(2)}</span>
					</Row>
				</>
			) : (
				<>
					<Row label="Fill">
						<input
							onChange={(e) => setFillColor(e.target.value)}
							style={colorInputStyle}
							type="color"
							value={fillColor}
						/>
						<input
							max={1}
							min={0}
							onChange={(e) => setFillOpacity(parseFloat(e.target.value))}
							step={0.05}
							style={{ flex: 1 }}
							type="range"
							value={fillOpacity}
						/>
						<span style={{ minWidth: 32, textAlign: "right" }}>{fillOpacity.toFixed(2)}</span>
					</Row>
					<Row label="Stroke">
						<input
							onChange={(e) => setStrokeColor(e.target.value)}
							style={colorInputStyle}
							type="color"
							value={strokeColor}
						/>
						<input
							max={8}
							min={0}
							onChange={(e) => setStrokeWidth(parseFloat(e.target.value))}
							step={0.5}
							style={{ flex: 1 }}
							type="range"
							value={strokeWidth}
						/>
						<span style={{ minWidth: 32, textAlign: "right" }}>{strokeWidth}px</span>
					</Row>
				</>
			)}

			<div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
				<button
					disabled={busy}
					onClick={apply}
					style={{
						padding: "4px 10px",
						fontSize: 11,
						fontWeight: 600,
						background: "var(--vscode-button-background, #0e639c)",
						color: "var(--vscode-button-foreground, #fff)",
						border: "none",
						borderRadius: 3,
						cursor: busy ? "not-allowed" : "pointer",
						opacity: busy ? 0.6 : 1,
					}}
					type="button">
					Apply
				</button>
			</div>
		</div>
	)
}

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
	<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
		<span style={{ minWidth: 56, opacity: 0.7 }}>{label}</span>
		{children}
	</div>
)

const colorInputStyle: React.CSSProperties = {
	width: 28,
	height: 22,
	padding: 0,
	border: "1px solid rgba(255,255,255,0.2)",
	borderRadius: 3,
	cursor: "pointer",
	background: "transparent",
}

const selectStyle = (fg: string, border: string, bg: string, disabled = false): React.CSSProperties => ({
	padding: "3px 6px",
	fontSize: 11,
	background: bg,
	color: fg,
	border: `1px solid ${border}`,
	borderRadius: 3,
	cursor: disabled ? "not-allowed" : "pointer",
	flex: 1,
	opacity: disabled ? 0.58 : 1,
})

// ─── Raster Histogram ────────────────────────────────────────────────────────

// Colormap hex stops — must match rasterCache.ts COLORMAPS order.
const CM_STOPS: Record<string, string[]> = {
	viridis: ["#440154", "#31688e", "#35b779", "#fde725"],
	viridis_r: ["#fde725", "#35b779", "#31688e", "#440154"],
	YlOrRd: ["#ffffb2", "#fecc5c", "#fd8d3c", "#e31a1c"],
	Blues: ["#f7fbff", "#6baed6", "#2171b5", "#084594"],
	RdYlGn: ["#d73027", "#fee08b", "#1a9850"],
	plasma: ["#0d0887", "#cc4778", "#f0f921"],
	magma: ["#000004", "#b73779", "#fcfdbf"],
	cividis: ["#00224e", "#7c7b78", "#fde737"],
}

interface RasterHistogramProps {
	rawPixels: { data: Float32Array; min: number; max: number }
	colormap: string
	fg: string
	border: string
	stretchMin: number
	stretchMax: number
	onStretchChange: (min: number, max: number) => void
}

const RasterHistogram: React.FC<RasterHistogramProps> = ({
	rawPixels,
	colormap,
	fg,
	border,
	stretchMin,
	stretchMax,
	onStretchChange,
}) => {
	const BINS = 40
	const { bins, min, max, mean } = useMemo(() => {
		const { data, min: dataMin, max: dataMax } = rawPixels
		const counts = new Array<number>(BINS).fill(0)
		let sum = 0
		let n = 0
		const range = dataMax - dataMin || 1
		for (let i = 0; i < data.length; i++) {
			const v = data[i]
			if (!Number.isFinite(v)) {
				continue
			}
			const bin = Math.min(BINS - 1, Math.floor(((v - dataMin) / range) * BINS))
			counts[bin]++
			sum += v
			n++
		}
		return { bins: counts, min: dataMin, max: dataMax, mean: n > 0 ? sum / n : 0 }
	}, [rawPixels])

	const maxCount = Math.max(...bins, 1)
	const W = 220
	const H = 52
	const barW = W / BINS
	const stops = CM_STOPS[colormap] ?? CM_STOPS.viridis
	const gradId = `hg-${colormap.replace(/[^a-z]/gi, "")}` // stable, no spaces/special chars

	// Stretch indicator positions (pixel x within the SVG)
	const range = max - min || 1
	const sMinX = Math.max(0, Math.min(W, ((stretchMin - min) / range) * W))
	const sMaxX = Math.max(0, Math.min(W, ((stretchMax - min) / range) * W))

	const fmt = (v: number) => (Math.abs(v) >= 1000 || (Math.abs(v) < 0.01 && v !== 0) ? v.toExponential(2) : v.toFixed(3))

	// Gradient CSS string for the bottom strip
	const gradientCss = `linear-gradient(to right,${stops.join(",")})`

	return (
		<div style={{ marginBottom: 2 }}>
			<div style={{ fontSize: 10, opacity: 0.6, marginBottom: 3 }}>Value distribution</div>
			<div
				style={{
					position: "relative",
					border: `1px solid ${border}`,
					borderRadius: 4,
					overflow: "hidden",
					background: "rgba(0,0,0,0.18)",
				}}>
				{/* Colormap gradient strip at bottom */}
				<div
					style={{
						position: "absolute",
						bottom: 0,
						left: 0,
						right: 0,
						height: 4,
						background: gradientCss,
					}}
				/>
				<svg height={H} preserveAspectRatio="none" style={{ display: "block", width: "100%" }} viewBox={`0 0 ${W} ${H}`}>
					<defs>
						{/* userSpaceOnUse: gradient spans the whole SVG width,
						    each bar gets the color matching its position in the data range */}
						<linearGradient gradientUnits="userSpaceOnUse" id={gradId} x1="0" x2={W} y1="0" y2="0">
							{stops.map((color, i) => (
								<stop key={i} offset={`${Math.round((i / (stops.length - 1)) * 100)}%`} stopColor={color} />
							))}
						</linearGradient>
					</defs>
					{/* Dimmed mask outside stretch range */}
					{sMinX > 0 && <rect fill="rgba(0,0,0,0.4)" height={H - 4} width={sMinX} x={0} y={0} />}
					{sMaxX < W && <rect fill="rgba(0,0,0,0.4)" height={H - 4} width={W - sMaxX} x={sMaxX} y={0} />}
					{/* Histogram bars filled with colormap gradient */}
					{bins.map((count, i) => {
						const barH = Math.round((count / maxCount) * (H - 6))
						return (
							<rect
								fill={`url(#${gradId})`}
								height={barH}
								key={i}
								opacity={0.9}
								width={Math.max(1, barW - 0.5)}
								x={i * barW}
								y={H - 4 - barH}
							/>
						)
					})}
					{/* Stretch min/max indicator lines */}
					<line
						stroke="rgba(255,255,255,0.85)"
						strokeDasharray="3,2"
						strokeWidth={1.5}
						x1={sMinX}
						x2={sMinX}
						y1={0}
						y2={H - 4}
					/>
					<line
						stroke="rgba(255,255,255,0.85)"
						strokeDasharray="3,2"
						strokeWidth={1.5}
						x1={sMaxX}
						x2={sMaxX}
						y1={0}
						y2={H - 4}
					/>
				</svg>
			</div>
			{/* Min / Mean / Max data labels */}
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					fontSize: 9,
					opacity: 0.55,
					color: fg,
					marginTop: 2,
					marginBottom: 4,
					fontVariantNumeric: "tabular-nums",
				}}>
				<span title="Data minimum">{fmt(min)}</span>
				<span style={{ opacity: 0.75 }} title="Mean">
					μ {fmt(mean)}
				</span>
				<span title="Data maximum">{fmt(max)}</span>
			</div>
			{/* Stretch controls */}
			<div style={{ fontSize: 10, opacity: 0.65, marginBottom: 3 }}>Stretch</div>
			<div style={{ display: "flex", alignItems: "center", gap: 5 }}>
				<span style={{ fontSize: 9, opacity: 0.6, minWidth: 22 }}>Min</span>
				<input
					onChange={(e) => {
						const v = parseFloat(e.target.value)
						if (Number.isFinite(v) && v < stretchMax) {
							onStretchChange(v, stretchMax)
						}
					}}
					step={(max - min) / 100 || 0.01}
					style={{
						flex: 1,
						padding: "2px 4px",
						fontSize: 10,
						background: "rgba(255,255,255,0.07)",
						color: fg,
						border: `1px solid ${border}`,
						borderRadius: 3,
						minWidth: 0,
					}}
					type="number"
					value={stretchMin}
				/>
				<span style={{ fontSize: 9, opacity: 0.6, minWidth: 22 }}>Max</span>
				<input
					onChange={(e) => {
						const v = parseFloat(e.target.value)
						if (Number.isFinite(v) && v > stretchMin) {
							onStretchChange(stretchMin, v)
						}
					}}
					step={(max - min) / 100 || 0.01}
					style={{
						flex: 1,
						padding: "2px 4px",
						fontSize: 10,
						background: "rgba(255,255,255,0.07)",
						color: fg,
						border: `1px solid ${border}`,
						borderRadius: 3,
						minWidth: 0,
					}}
					type="number"
					value={stretchMax}
				/>
				<button
					onClick={() => onStretchChange(min, max)}
					style={{
						padding: "2px 5px",
						fontSize: 9,
						background: "transparent",
						color: fg,
						border: `1px solid ${border}`,
						borderRadius: 3,
						cursor: "pointer",
						opacity: 0.7,
						whiteSpace: "nowrap",
					}}
					title="Reset to full data range"
					type="button">
					↺ Reset
				</button>
			</div>
		</div>
	)
}

export default SymbologyEditor
