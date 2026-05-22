import { LoadRoiFromWorkspaceRequest, SaveRoiToWorkspaceRequest } from "@shared/proto/cline/map"
import React, { useState } from "react"
import { MapServiceClient } from "../../services/grpc-client"
import type { ActiveRoi } from "./mapWorkspace"

interface MapRoiStripProps {
	roi: ActiveRoi | undefined
	mapStyle: string
	onClear?: () => void
	onRefresh?: () => void
}

/**
 * Compact active-ROI indicator (geemap-style basin context).
 * Synced with host MapSessionService; save/load persists to workspace roi/.
 */
export const MapRoiStrip: React.FC<MapRoiStripProps> = ({ roi, mapStyle, onClear, onRefresh }) => {
	const [busy, setBusy] = useState(false)
	const [status, setStatus] = useState<string | null>(null)
	const isDark = mapStyle === "dark"
	const bg = isDark ? "rgba(18,18,26,0.9)" : "rgba(252,252,252,0.92)"
	const fg = isDark ? "var(--vscode-foreground, #ddd)" : "var(--vscode-foreground, #222)"
	const border = isDark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.12)"
	const warn = "var(--vscode-editorWarning-foreground, #cca700)"

	const btnStyle: React.CSSProperties = {
		padding: "0 6px",
		fontSize: 10,
		background: "transparent",
		border: `1px solid ${border}`,
		borderRadius: 3,
		color: fg,
		cursor: "pointer",
	}

	const handleSave = async () => {
		const name = window.prompt("Save ROI as (filename slug):", roi?.name?.replace(/\s+/g, "_") || "basin")
		if (!name) {
			return
		}
		setBusy(true)
		setStatus(null)
		try {
			const res = await MapServiceClient.saveRoiToWorkspace(SaveRoiToWorkspaceRequest.create({ name }))
			setStatus(`Saved ${res.workspacePath}`)
			onRefresh?.()
		} catch (err) {
			setStatus(err instanceof Error ? err.message : "Save failed")
		} finally {
			setBusy(false)
			window.setTimeout(() => setStatus(null), 4000)
		}
	}

	const handleLoad = async () => {
		setBusy(true)
		setStatus(null)
		try {
			await MapServiceClient.loadRoiFromWorkspace(LoadRoiFromWorkspaceRequest.create({}))
			onRefresh?.()
			setStatus("Loaded active ROI from workspace")
		} catch (err) {
			setStatus(err instanceof Error ? err.message : "Load failed — save an ROI first")
		} finally {
			setBusy(false)
			window.setTimeout(() => setStatus(null), 4000)
		}
	}

	if (!roi?.name) {
		return (
			<div
				style={{
					position: "absolute",
					top: 10,
					left: "50%",
					transform: "translateX(-50%)",
					zIndex: 4,
					display: "flex",
					flexDirection: "column",
					alignItems: "center",
					gap: 4,
					maxWidth: "90%",
				}}>
				<div
					style={{
						padding: "4px 12px",
						background: bg,
						border: `1px solid ${border}`,
						borderRadius: 4,
						fontSize: 10,
						color: warn,
						textAlign: "center",
					}}
					title="Draw ROI via Measure, load from workspace, or ask the agent to delineate a basin">
					No active ROI — draw, load, or ask the agent
				</div>
				<div style={{ display: "flex", gap: 6, pointerEvents: "auto" }}>
					<button disabled={busy} onClick={() => void handleLoad()} style={btnStyle} type="button">
						Load ROI
					</button>
				</div>
				{status && <span style={{ fontSize: 9, color: fg, opacity: 0.8 }}>{status}</span>}
			</div>
		)
	}

	const area =
		roi.areaHa !== undefined && Number.isFinite(roi.areaHa)
			? `${roi.areaHa.toLocaleString(undefined, { maximumFractionDigits: 1 })} ha`
			: null

	return (
		<div
			style={{
				position: "absolute",
				top: 10,
				left: "50%",
				transform: "translateX(-50%)",
				zIndex: 4,
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				gap: 4,
				maxWidth: "min(90%, 480px)",
				pointerEvents: "none",
			}}>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 8,
					padding: "4px 10px",
					background: bg,
					border: `1px solid ${border}`,
					borderRadius: 4,
					fontSize: 10,
					color: fg,
					pointerEvents: "auto",
				}}>
				<span style={{ fontWeight: 600, whiteSpace: "nowrap" }}>ROI</span>
				<span
					style={{
						overflow: "hidden",
						textOverflow: "ellipsis",
						whiteSpace: "nowrap",
					}}
					title={roi.name}>
					{roi.name}
				</span>
				{roi.source && <span style={{ opacity: 0.65 }}>({roi.source})</span>}
				{area && <span style={{ opacity: 0.65 }}>{area}</span>}
				<button
					disabled={busy}
					onClick={() => void handleSave()}
					style={btnStyle}
					title="Save to workspace roi/"
					type="button">
					Save
				</button>
				<button
					disabled={busy}
					onClick={() => void handleLoad()}
					style={btnStyle}
					title="Load roi/active.json"
					type="button">
					Load
				</button>
				{onClear && (
					<button onClick={onClear} style={btnStyle} title="Clear active ROI" type="button">
						×
					</button>
				)}
			</div>
			{status && <span style={{ fontSize: 9, color: fg, opacity: 0.85, pointerEvents: "none" }}>{status}</span>}
		</div>
	)
}

export default MapRoiStrip
