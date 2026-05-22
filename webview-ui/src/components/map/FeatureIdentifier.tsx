import React, { useEffect, useState } from "react"
import type { CursorRasterReading } from "./mapLayerAdapters"

export interface ClickedFeature {
	layerId: string
	layerName: string
	properties: Record<string, unknown>
}

export interface MapInspectPoint {
	lon: number
	lat: number
}

interface FeatureIdentifierProps {
	features: ClickedFeature[]
	inspectPoint?: MapInspectPoint | null
	rasterReading?: CursorRasterReading | null
	mapStyle: string
	onClose: () => void
	onAgentDelineate?: (point: MapInspectPoint) => void | Promise<void>
	onAgentAsk?: (point: MapInspectPoint) => void | Promise<void>
	onQuickDelineate?: (point: MapInspectPoint) => void | Promise<void>
	agentStarting?: boolean
	agentStatus?: string | null
	delineating?: boolean
	delineateStatus?: string | null
}

/** Bottom-right inspector — clear of the top-right tool ribbon. */
const FeatureIdentifier: React.FC<FeatureIdentifierProps> = ({
	features,
	inspectPoint,
	rasterReading,
	mapStyle,
	onClose,
	onAgentDelineate,
	onAgentAsk,
	onQuickDelineate,
	agentStarting = false,
	agentStatus,
	delineating = false,
	delineateStatus,
}) => {
	const [currentIndex, setCurrentIndex] = useState(0)

	useEffect(() => {
		setCurrentIndex(0)
	}, [features])

	if (features.length === 0 && !inspectPoint && !rasterReading) {
		return null
	}

	const current = features[currentIndex]
	const hasFeatures = features.length > 0
	const isDark = mapStyle === "dark"
	const bg = isDark ? "rgba(22,22,30,0.94)" : "rgba(252,252,252,0.96)"
	const fg = isDark ? "rgba(255,255,255,0.92)" : "rgba(0,0,0,0.88)"
	const bdClr = isDark ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.12)"
	const muted = isDark ? "rgba(255,255,255,0.55)" : "rgba(0,0,0,0.55)"
	const accentText = isDark ? "#7ec8ff" : "#0e639c"

	const entries = hasFeatures
		? Object.entries(current.properties)
				.filter(([k]) => !k.startsWith("_"))
				.slice(0, 6)
		: []
	const extra = hasFeatures ? Object.entries(current.properties).filter(([k]) => !k.startsWith("_")).length - entries.length : 0

	const coordLine =
		inspectPoint &&
		`${Math.abs(inspectPoint.lat).toFixed(5)}°${inspectPoint.lat >= 0 ? "N" : "S"}, ${Math.abs(inspectPoint.lon).toFixed(5)}°${inspectPoint.lon >= 0 ? "E" : "W"}`

	const btnStyle: React.CSSProperties = {
		width: 22,
		height: 22,
		padding: 0,
		border: `1px solid ${bdClr}`,
		background: "transparent",
		color: fg,
		cursor: "pointer",
		borderRadius: 3,
		fontSize: 11,
		lineHeight: 1,
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
	}

	const primaryBtn: React.CSSProperties = {
		width: "100%",
		padding: "5px 8px",
		fontSize: 10,
		fontWeight: 600,
		cursor: agentStarting ? "wait" : "pointer",
		border: `1px solid ${bdClr}`,
		borderRadius: 4,
		background: isDark ? "rgba(30,90,140,0.55)" : "rgba(14,99,156,0.18)",
		color: accentText,
		opacity: agentStarting ? 0.7 : 1,
	}

	const secondaryBtn: React.CSSProperties = {
		...primaryBtn,
		fontWeight: 500,
		background: "transparent",
		marginTop: 4,
	}

	const showActions = inspectPoint && (onAgentDelineate || onAgentAsk || onQuickDelineate)
	const askLabel = hasFeatures ? "Ask about this outlet" : "Ask about map layers & outlet"

	return (
		<div
			aria-label="Feature inspector"
			role="dialog"
			style={{
				position: "absolute",
				bottom: 48,
				right: 52,
				zIndex: 5,
				width: "max-content",
				minWidth: 200,
				maxWidth: 260,
				maxHeight: 280,
				display: "flex",
				flexDirection: "column",
				background: bg,
				border: `1px solid ${bdClr}`,
				borderRadius: 6,
				boxShadow: "0 2px 10px rgba(0,0,0,0.32)",
				fontFamily: "var(--vscode-font-family, system-ui, sans-serif)",
				fontSize: 11,
				color: fg,
				pointerEvents: "auto",
			}}>
			{/* Compact header */}
			<div
				style={{
					padding: "6px 8px",
					borderBottom: entries.length > 0 || rasterReading || showActions ? `1px solid ${bdClr}` : undefined,
					display: "flex",
					alignItems: "flex-start",
					gap: 6,
					flexShrink: 0,
				}}>
				<div style={{ flex: 1, minWidth: 0 }}>
					{hasFeatures ? (
						<div
							style={{
								fontSize: 12,
								fontWeight: 600,
								overflow: "hidden",
								textOverflow: "ellipsis",
								whiteSpace: "nowrap",
								lineHeight: 1.3,
							}}
							title={current.layerName}>
							{current.layerName}
						</div>
					) : (
						<div style={{ fontSize: 11, fontWeight: 600 }}>Map click</div>
					)}
					{coordLine && (
						<div
							style={{
								fontSize: 9,
								color: muted,
								fontFamily: "var(--vscode-editor-font-family, monospace)",
								marginTop: 2,
								lineHeight: 1.3,
							}}>
							{coordLine}
						</div>
					)}
				</div>
				{hasFeatures && features.length > 1 && (
					<div style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
						<button
							onClick={() => setCurrentIndex((i) => (i === 0 ? features.length - 1 : i - 1))}
							style={btnStyle}
							title="Previous feature"
							type="button">
							‹
						</button>
						<span style={{ fontSize: 9, color: muted, minWidth: 28, textAlign: "center" }}>
							{currentIndex + 1}/{features.length}
						</span>
						<button
							onClick={() => setCurrentIndex((i) => (i === features.length - 1 ? 0 : i + 1))}
							style={btnStyle}
							title="Next feature"
							type="button">
							›
						</button>
					</div>
				)}
				<button
					aria-label="Close inspector"
					onClick={onClose}
					style={{ ...btnStyle, flexShrink: 0, opacity: 0.85 }}
					title="Close"
					type="button">
					✕
				</button>
			</div>

			{(rasterReading || entries.length > 0 || (!hasFeatures && !rasterReading) || showActions) && (
				<div style={{ padding: "6px 8px", overflowY: "auto", flex: 1, minHeight: 0 }}>
					{rasterReading && (
						<div style={{ marginBottom: entries.length > 0 ? 6 : 0, fontSize: 10 }}>
							<span style={{ color: muted }}>{rasterReading.layerName}: </span>
							<span style={{ color: accentText, fontFamily: "monospace" }}>
								{Number.isFinite(rasterReading.value) ? rasterReading.value.toPrecision(4) : "—"}
								{rasterReading.units ? ` ${rasterReading.units}` : ""}
							</span>
						</div>
					)}
					{!hasFeatures && !rasterReading && (
						<div style={{ fontSize: 10, color: muted, fontStyle: "italic" }}>No features at this point.</div>
					)}
					{entries.map(([key, value]) => (
						<div
							key={key}
							style={{
								display: "grid",
								gridTemplateColumns: "72px 1fr",
								gap: "2px 8px",
								marginBottom: 3,
								fontSize: 10,
								alignItems: "start",
							}}>
							<span style={{ color: muted, overflow: "hidden", textOverflow: "ellipsis" }} title={key}>
								{key}
							</span>
							<span
								style={{
									color: accentText,
									fontFamily: "var(--vscode-editor-font-family, monospace)",
									wordBreak: "break-word",
									lineHeight: 1.35,
								}}>
								{String(value ?? "—")}
							</span>
						</div>
					))}
					{extra > 0 && <div style={{ fontSize: 9, color: muted, fontStyle: "italic" }}>+{extra} more</div>}
					{showActions && (
						<div style={{ marginTop: 8 }}>
							{onAgentDelineate && (
								<button
									disabled={agentStarting || delineating}
									onClick={() => void onAgentDelineate(inspectPoint)}
									style={primaryBtn}
									title="Start an agent task to delineate and push the watershed to the map"
									type="button">
									{agentStarting ? "Opening chat…" : "Delineate with agent"}
								</button>
							)}
							{onAgentAsk && (
								<button
									disabled={agentStarting || delineating}
									onClick={() => void onAgentAsk(inspectPoint)}
									style={secondaryBtn}
									title="Ask the agent about this outlet, layers, or next steps"
									type="button">
									{askLabel}
								</button>
							)}
							{onQuickDelineate && (
								<div style={{ marginTop: 6 }}>
									<button
										disabled={delineating || agentStarting}
										onClick={() => void onQuickDelineate(inspectPoint)}
										style={{
											...secondaryBtn,
											marginTop: 0,
											fontSize: 9,
											padding: "3px 6px",
											textDecoration: delineating ? "none" : "underline",
											border: "none",
										}}
										title="Fast cloud-DEM delineation after river snap — approximate boundary"
										type="button">
										{delineating ? "Delineating…" : "Quick delineate"}
									</button>
									<div style={{ marginTop: 4, fontSize: 8, color: muted, lineHeight: 1.35 }}>
										{delineating
											? "Delineating… (this may take several minutes)"
											: "Approximate watershed (cloud DEM + snap). Area and shape can differ from gauges or field data — use Delineate with agent for a fuller check."}
									</div>
								</div>
							)}
							{(agentStatus || delineateStatus) && (
								<div style={{ marginTop: 6, fontSize: 9, color: muted, lineHeight: 1.35 }}>
									{agentStatus || delineateStatus}
								</div>
							)}
						</div>
					)}
				</div>
			)}
		</div>
	)
}

export default FeatureIdentifier
