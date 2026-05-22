import React, { useState } from "react"
import { fmtArea, fmtDist } from "./geoMeasureMath"
import type { CompletedVectorDraw } from "./VectorDrawTool"

interface VectorSavePanelProps {
	draw: CompletedVectorDraw
	mapStyle: string
	busy?: boolean
	onSave: (name: string) => void
	onExport: () => void
	onDiscard: () => void
}

export const VectorSavePanel: React.FC<VectorSavePanelProps> = ({
	draw,
	mapStyle,
	busy = false,
	onSave,
	onExport,
	onDiscard,
}) => {
	const defaultName =
		draw.mode === "polygon"
			? `polygon_${draw.areaKm2 ? Math.round(draw.areaKm2 * 100) : "drawn"}`
			: draw.mode === "line"
				? `line_${draw.lengthKm ? Math.round(draw.lengthKm * 10) : "drawn"}`
				: "point_1"
	const [name, setName] = useState(defaultName)
	const isDark = mapStyle === "dark"
	const fg = isDark ? "var(--vscode-foreground, #ddd)" : "var(--vscode-foreground, #222)"
	const bg = isDark ? "rgba(20,20,28,0.96)" : "rgba(252,252,252,0.96)"
	const border = isDark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.12)"
	const accent = "#2d9f6f"

	const btn: React.CSSProperties = {
		padding: "6px 12px",
		fontSize: 12,
		borderRadius: 4,
		border: `1px solid ${border}`,
		cursor: busy ? "wait" : "pointer",
		fontFamily: "inherit",
	}

	return (
		<div
			style={{
				position: "absolute",
				bottom: 56,
				left: "50%",
				transform: "translateX(-50%)",
				zIndex: 6,
				width: "min(420px, 92vw)",
				padding: "14px 16px",
				background: bg,
				border: `1px solid ${accent}`,
				borderRadius: 8,
				boxShadow: "0 4px 20px rgba(0,0,0,0.35)",
				color: fg,
				fontFamily: "var(--vscode-font-family, system-ui, sans-serif)",
				fontSize: 12,
				pointerEvents: "auto",
			}}>
			<div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6, color: accent }}>Vector ready — save to workspace</div>
			<div style={{ fontSize: 11, opacity: 0.85, marginBottom: 10, lineHeight: 1.5 }}>
				{draw.mode === "polygon" && draw.areaKm2 != null && <>Area: {fmtArea(draw.areaKm2)} · </>}
				{draw.mode === "line" && draw.lengthKm != null && <>Length: {fmtDist(draw.lengthKm)} · </>}
				{draw.pointCount} vertex{draw.pointCount === 1 ? "" : "es"} — file will appear in Layers after save
			</div>
			<label style={{ display: "block", fontSize: 11, marginBottom: 4, opacity: 0.8 }}>File name (slug)</label>
			<input
				disabled={busy}
				onChange={(e) => setName(e.target.value)}
				style={{
					width: "100%",
					boxSizing: "border-box",
					padding: "6px 8px",
					marginBottom: 12,
					fontSize: 12,
					background: isDark ? "rgba(0,0,0,0.3)" : "#fff",
					color: fg,
					border: `1px solid ${border}`,
					borderRadius: 4,
				}}
				type="text"
				value={name}
			/>
			<div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "flex-end" }}>
				<button
					disabled={busy}
					onClick={onDiscard}
					style={{ ...btn, background: "transparent", color: fg }}
					type="button">
					Discard
				</button>
				<button
					disabled={busy}
					onClick={onExport}
					style={{ ...btn, background: "transparent", color: fg }}
					title="Download GeoJSON to your computer"
					type="button">
					Export GeoJSON
				</button>
				<button
					disabled={busy || !name.trim()}
					onClick={() => onSave(name.trim())}
					style={{
						...btn,
						background: accent,
						color: "#fff",
						border: "none",
						fontWeight: 600,
					}}
					type="button">
					{busy ? "Saving…" : "Save to workspace"}
				</button>
			</div>
		</div>
	)
}

export default VectorSavePanel
