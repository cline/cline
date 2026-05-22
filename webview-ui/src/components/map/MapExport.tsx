import React, { useState } from "react"

interface MapExportProps {
	mapStyle?: "dark" | "light"
	onClose?: () => void
}

export const MapExport: React.FC<MapExportProps> = ({ mapStyle = "dark", onClose }) => {
	const [status, setStatus] = useState<{ kind: "idle" | "ok" | "err"; msg: string }>({ kind: "idle", msg: "" })
	const isDark = mapStyle === "dark"
	const fg = isDark ? "var(--vscode-foreground, #ddd)" : "var(--vscode-foreground, #222)"
	const bg = isDark ? "rgba(20,20,28,0.96)" : "rgba(248,248,250,0.97)"
	const border = isDark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.14)"
	const accent = "var(--vscode-button-background, #0e639c)"

	const handleExport = () => {
		try {
			// Find the deck.gl canvas
			const canvas = document.querySelector("canvas.deckgl-overlay, canvas") as HTMLCanvasElement | null
			if (!canvas) {
				setStatus({ kind: "err", msg: "Canvas not found — is the map rendered?" })
				return
			}
			const dataUrl = canvas.toDataURL("image/png")
			const a = document.createElement("a")
			a.href = dataUrl
			a.download = `ai-hydro-map-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.png`
			a.click()
			setStatus({ kind: "ok", msg: "Map saved as PNG." })
			window.setTimeout(() => setStatus({ kind: "idle", msg: "" }), 3000)
		} catch (e) {
			setStatus({ kind: "err", msg: `Export failed: ${String(e)}` })
		}
	}

	return (
		<div
			style={{
				padding: "10px 14px",
				background: bg,
				border: `1px solid ${border}`,
				borderRadius: 5,
				boxShadow: "0 1px 5px rgba(0,0,0,0.28)",
				color: fg,
				fontFamily: "var(--vscode-font-family, system-ui, sans-serif)",
				fontSize: 12,
				minWidth: 220,
				pointerEvents: "auto",
			}}>
			<div style={{ fontWeight: 600, marginBottom: 6, fontSize: 11 }}>🖼️ Export Map</div>
			<div style={{ fontSize: 10, opacity: 0.75, marginBottom: 8 }}>Save the current map view as a PNG image.</div>
			<button
				onClick={handleExport}
				style={{
					width: "100%",
					padding: "6px 10px",
					fontSize: 12,
					fontWeight: 500,
					background: accent,
					color: "#fff",
					border: "none",
					borderRadius: 3,
					cursor: "pointer",
				}}>
				Save PNG
			</button>
			{status.msg && (
				<div
					style={{
						marginTop: 6,
						fontSize: 11,
						color: status.kind === "err" ? "#dc3545" : "var(--vscode-descriptionForeground, #999)",
					}}>
					{status.msg}
				</div>
			)}
			<button
				onClick={onClose}
				style={{
					marginTop: 8,
					width: "100%",
					padding: "4px 8px",
					fontSize: 11,
					background: "transparent",
					border: `1px solid ${border}`,
					borderRadius: 3,
					color: fg,
					cursor: "pointer",
				}}>
				Close
			</button>
		</div>
	)
}

export default MapExport
