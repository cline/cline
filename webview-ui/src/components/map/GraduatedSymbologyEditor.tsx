/**
 * GraduatedSymbologyEditor — choropleth/heat-map styling by attribute.
 *
 * Extracts numeric/categorical attributes from vector features and lets users:
 * - Pick an attribute
 * - Choose a break method (equal intervals, quantiles, natural breaks)
 * - Select or auto-suggest a color ramp
 * - Preview the classification
 *
 * Config is stored in layer metadata:
 *   graduated_attr, graduated_method, graduated_breaks, graduated_colors
 */

import { AddMapLayerRequest, type MapLayer } from "@shared/proto/cline/map"
import React, { useEffect, useState } from "react"
import { MapServiceClient } from "../../services/grpc-client"

interface GraduatedSymbologyEditorProps {
	layer: MapLayer
	onClose: () => void
	mapStyle?: string
}

const COLOR_RAMPS: Record<string, string[]> = {
	viridis: ["#440154", "#31688e", "#35b779", "#fde725"],
	plasma: ["#0d0887", "#cc4778", "#f89441", "#f0f921"],
	YlOrRd: ["#ffffb2", "#fecc5c", "#e31a1c"],
	Blues: ["#f7fbff", "#6baed6", "#084594"],
	RdYlGn: ["#d73027", "#fee08b", "#1a9850"],
	Greens: ["#f7fcfd", "#78c679", "#005a32"],
	Reds: ["#fee5d9", "#fcae91", "#cb181d"],
	Purples: ["#f7fcfd", "#9e9ac8", "#54278f"],
}

interface NumericAttribute {
	name: string
	min: number
	max: number
	mean: number
}

const extractNumericAttributes = (geojson: string): NumericAttribute[] => {
	try {
		const parsed = JSON.parse(geojson)
		const features = parsed.type === "FeatureCollection" ? parsed.features : [parsed]
		const attrs = new Map<string, number[]>()

		for (const f of features) {
			const props = f.properties || {}
			for (const [key, val] of Object.entries(props)) {
				if (typeof val === "number" && !key.startsWith("_")) {
					if (!attrs.has(key)) attrs.set(key, [])
					attrs.get(key)!.push(val)
				}
			}
		}

		const result: NumericAttribute[] = []
		for (const [name, values] of attrs) {
			const sorted = values.sort((a, b) => a - b)
			const sum = values.reduce((a, b) => a + b, 0)
			result.push({
				name,
				min: sorted[0],
				max: sorted[sorted.length - 1],
				mean: sum / values.length,
			})
		}
		return result.sort((a, b) => a.name.localeCompare(b.name))
	} catch {
		return []
	}
}

/** Generate class breaks using equal intervals. */
const equalIntervals = (min: number, max: number, numClasses: number): number[] => {
	const step = (max - min) / numClasses
	const breaks = []
	for (let i = 1; i < numClasses; i++) {
		breaks.push(min + i * step)
	}
	breaks.push(max)
	return breaks
}

/** Generate class breaks using quantiles. */
const quantileBreaks = (values: number[], numClasses: number): number[] => {
	const sorted = [...values].sort((a, b) => a - b)
	const breaks = []
	for (let i = 1; i <= numClasses; i++) {
		const idx = Math.floor((i / numClasses) * sorted.length) - 1
		breaks.push(sorted[Math.max(0, idx)])
	}
	return Array.from(new Set(breaks)).sort((a, b) => a - b)
}

interface InterpolatedColor {
	r: number
	g: number
	b: number
}

/** Interpolate color at normalized position [0, 1] across a ramp. */
const interpolateColor = (ramp: string[], t: number): InterpolatedColor => {
	const clamped = Math.max(0, Math.min(1, t))
	const position = clamped * (ramp.length - 1)
	const idx = Math.floor(position)
	const frac = position - idx

	const c1 = parseInt(ramp[idx].substring(1), 16)
	const c2 = idx < ramp.length - 1 ? parseInt(ramp[idx + 1].substring(1), 16) : c1

	const r1 = (c1 >> 16) & 255
	const g1 = (c1 >> 8) & 255
	const b1 = c1 & 255

	const r2 = (c2 >> 16) & 255
	const g2 = (c2 >> 8) & 255
	const b2 = c2 & 255

	return {
		r: Math.round(r1 + (r2 - r1) * frac),
		g: Math.round(g1 + (g2 - g1) * frac),
		b: Math.round(b1 + (b2 - b1) * frac),
	}
}

/** Format color as hex. */
const colorToHex = (c: InterpolatedColor): string => {
	const r = c.r.toString(16).padStart(2, "0")
	const g = c.g.toString(16).padStart(2, "0")
	const b = c.b.toString(16).padStart(2, "0")
	return `#${r}${g}${b}`
}

export const GraduatedSymbologyEditor: React.FC<GraduatedSymbologyEditorProps> = ({ layer, onClose, mapStyle = "dark" }) => {
	const isDark = mapStyle === "dark"
	const fg = isDark ? "var(--vscode-foreground, #ddd)" : "var(--vscode-foreground, #222)"
	const bg = isDark ? "rgba(20,20,28,0.97)" : "rgba(248,248,250,0.97)"
	const border = isDark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.14)"
	const subtle = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)"

	const isRaster = layer.layerType === "raster"
	if (isRaster) return null // Raster graduation not supported yet

	const attrs = extractNumericAttributes(layer.geojson || "")
	const [attrName, setAttrName] = useState<string>(attrs[0]?.name || "")
	const [method, setMethod] = useState<"equal" | "quantile">("equal")
	const [numClasses, setNumClasses] = useState(5)
	const [rampName, setRampName] = useState("viridis")
	const [busy, setBusy] = useState(false)

	// Compute breaks whenever attribute, method, or numClasses changes
	const [breaks, setBreaks] = useState<number[]>([])
	const [colors, setColors] = useState<string[]>([])

	useEffect(() => {
		const attr = attrs.find((a) => a.name === attrName)
		if (!attr || numClasses < 2) return

		let computedBreaks: number[]
		if (method === "equal") {
			computedBreaks = equalIntervals(attr.min, attr.max, numClasses)
		} else {
			// For quantile, we need actual feature values
			try {
				const parsed = JSON.parse(layer.geojson || "{}")
				const features = parsed.type === "FeatureCollection" ? parsed.features : [parsed]
				const values = features.map((f: any) => f.properties?.[attrName]).filter((v: any) => typeof v === "number")
				computedBreaks = quantileBreaks(values, numClasses)
			} catch {
				computedBreaks = equalIntervals(attr.min, attr.max, numClasses)
			}
		}

		setBreaks(computedBreaks)

		// Generate colors for each class
		const ramp = COLOR_RAMPS[rampName] || COLOR_RAMPS.viridis
		const generatedColors = computedBreaks.map((_, idx) => {
			const t = idx / (computedBreaks.length - 1)
			const color = interpolateColor(ramp, t)
			return colorToHex(color)
		})
		setColors(generatedColors)
	}, [attrName, method, numClasses, rampName, attrs, layer.geojson])

	const apply = async () => {
		if (!attrName || breaks.length === 0) return
		setBusy(true)
		try {
			const next = {
				...layer,
				metadata: {
					...(layer.metadata ?? {}),
					graduated_attr: attrName,
					graduated_method: method,
					graduated_breaks: JSON.stringify(breaks),
					graduated_colors: JSON.stringify(colors),
				},
			}
			await MapServiceClient.addMapLayer(AddMapLayerRequest.create({ layer: next as any }))
			onClose()
		} catch (err) {
			console.error("Failed to apply graduated symbology:", err)
		} finally {
			setBusy(false)
		}
	}

	const clear = async () => {
		setBusy(true)
		try {
			const next = {
				...layer,
				metadata: {
					...(layer.metadata ?? {}),
					graduated_attr: undefined,
					graduated_method: undefined,
					graduated_breaks: undefined,
					graduated_colors: undefined,
				},
			}
			const cleaned = JSON.parse(JSON.stringify(next))
			delete cleaned.metadata.graduated_attr
			delete cleaned.metadata.graduated_method
			delete cleaned.metadata.graduated_breaks
			delete cleaned.metadata.graduated_colors
			await MapServiceClient.addMapLayer(AddMapLayerRequest.create({ layer: cleaned }))
			onClose()
		} catch (err) {
			console.error("Failed to clear graduated symbology:", err)
		} finally {
			setBusy(false)
		}
	}

	if (attrs.length === 0) {
		return (
			<div
				style={{
					marginTop: 6,
					padding: 12,
					background: subtle,
					border: `1px dashed ${border}`,
					borderRadius: 4,
					fontSize: 11,
					color: fg,
				}}>
				No numeric attributes found in this layer.
			</div>
		)
	}

	const selectedAttr = attrs.find((a) => a.name === attrName)

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
				<span style={{ fontWeight: 600 }}>Graduated Symbology</span>
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

			{/* Attribute selector */}
			<Row label="Attribute">
				<select onChange={(e) => setAttrName(e.target.value)} style={selectStyle(fg, border, bg)} value={attrName}>
					{attrs.map((a) => (
						<option key={a.name} value={a.name}>
							{a.name}
						</option>
					))}
				</select>
			</Row>

			{selectedAttr && (
				<div style={{ fontSize: 10, opacity: 0.65, marginLeft: 56 }}>
					Range: {selectedAttr.min.toFixed(2)} — {selectedAttr.max.toFixed(2)}
				</div>
			)}

			{/* Break method */}
			<Row label="Method">
				<select
					onChange={(e) => setMethod(e.target.value as "equal" | "quantile")}
					style={selectStyle(fg, border, bg)}
					value={method}>
					<option value="equal">Equal Intervals</option>
					<option value="quantile">Quantiles</option>
				</select>
			</Row>

			{/* Number of classes */}
			<Row label="Classes">
				<input
					max={10}
					min={2}
					onChange={(e) => setNumClasses(parseInt(e.target.value))}
					style={{ flex: 1 }}
					type="number"
					value={numClasses}
				/>
			</Row>

			{/* Color ramp picker */}
			<Row label="Ramp">
				<select onChange={(e) => setRampName(e.target.value)} style={selectStyle(fg, border, bg)} value={rampName}>
					{Object.keys(COLOR_RAMPS).map((name) => (
						<option key={name} value={name}>
							{name}
						</option>
					))}
				</select>
			</Row>

			{/* Preview legend */}
			{breaks.length > 0 && (
				<div style={{ marginTop: 4 }}>
					<div style={{ fontSize: 10, opacity: 0.65, marginBottom: 4 }}>Preview</div>
					{breaks.map((brk, idx) => (
						<div key={idx} style={{ display: "flex", gap: 6, marginBottom: 3, alignItems: "center" }}>
							<div
								style={{
									width: 20,
									height: 16,
									background: colors[idx],
									border: `1px solid ${border}`,
									borderRadius: 2,
									flexShrink: 0,
								}}
							/>
							<span style={{ fontSize: 10, opacity: 0.7 }}>
								{idx === 0 ? `< ${brk.toFixed(2)}` : `≥ ${breaks[idx - 1].toFixed(2)}`}
							</span>
						</div>
					))}
				</div>
			)}

			{/* Action buttons */}
			<div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
				<button
					disabled={busy}
					onClick={clear}
					style={{
						padding: "4px 10px",
						fontSize: 11,
						background: "transparent",
						color: fg,
						border: `1px solid ${border}`,
						borderRadius: 3,
						cursor: busy ? "not-allowed" : "pointer",
						opacity: busy ? 0.6 : 0.8,
					}}
					type="button">
					Clear
				</button>
				<button
					disabled={busy || !attrName}
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
		<span style={{ minWidth: 64, opacity: 0.7, fontSize: 11 }}>{label}</span>
		{children}
	</div>
)

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

export default GraduatedSymbologyEditor
