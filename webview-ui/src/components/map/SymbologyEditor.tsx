/**
 * SymbologyEditor — per-layer style editor (QGIS Layer Properties → Symbology, simplified).
 *
 * Vector layers: fill color + opacity, stroke color + width.
 * Raster layers: colormap dropdown + opacity slider.
 *
 * Edits are pushed back through MapService.addMapLayer (overwrite by id).
 */

import { AddMapLayerRequest, type MapLayer, MapLayerStyle } from "@shared/proto/cline/map"
import React, { useState } from "react"
import { MapServiceClient } from "../../services/grpc-client"

interface SymbologyEditorProps {
	layer: MapLayer
	onClose: () => void
	mapStyle?: string
}

const COLORMAPS = ["viridis", "viridis_r", "YlOrRd", "Blues", "RdYlGn", "plasma", "magma", "cividis"]

export const SymbologyEditor: React.FC<SymbologyEditorProps> = ({ layer, onClose, mapStyle = "dark" }) => {
	const isRaster = layer.layerType === "raster"
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
	const [busy, setBusy] = useState(false)

	const apply = async () => {
		setBusy(true)
		try {
			if (isRaster) {
				const next = {
					...layer,
					metadata: {
						...(layer.metadata ?? {}),
						raster_opacity: String(rasterOpacity),
						raster_colormap: rasterColormap,
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
				const next = { ...layer, style }
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
					<Row label="Colormap">
						<select
							onChange={(e) => setRasterColormap(e.target.value)}
							style={selectStyle(fg, border, bg)}
							value={rasterColormap}>
							{COLORMAPS.map((c) => (
								<option key={c} value={c}>
									{c}
								</option>
							))}
						</select>
					</Row>
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

const selectStyle = (fg: string, border: string, bg: string): React.CSSProperties => ({
	padding: "3px 6px",
	fontSize: 11,
	background: bg,
	color: fg,
	border: `1px solid ${border}`,
	borderRadius: 3,
	cursor: "pointer",
	flex: 1,
})

export default SymbologyEditor
