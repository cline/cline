import React, { useEffect, useState } from "react"
import type { CursorRasterReading } from "./mapLayerAdapters"

export interface ClickedFeature {
	layerId: string
	layerName: string
	properties: Record<string, unknown>
	geometry?: unknown
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
	onAddSelection?: (features: ClickedFeature[]) => void
	onClearSelection?: () => void
	onSaveFeatures?: (features: ClickedFeature[], format: "geojson" | "shapefile") => void | Promise<void>
	selectedFeatures?: ClickedFeature[]
	agentStarting?: boolean
	agentStatus?: string | null
	delineating?: boolean
	delineateStatus?: string | null
}

const QUICK_DELINEATE_MAX_MERIT_UPAREA_KM2 = 50_000

function numberProp(props: Record<string, unknown> | undefined, keys: string[]): number | undefined {
	if (!props) return undefined
	for (const key of keys) {
		const value = props[key]
		if (typeof value === "number" && Number.isFinite(value)) return value
		if (typeof value === "string") {
			const parsed = Number(value)
			if (Number.isFinite(parsed)) return parsed
		}
	}
	return undefined
}

function routingBadge(
	feature: ClickedFeature | undefined,
	point: MapInspectPoint | null | undefined,
):
	| {
			label: string
			title: string
			bg: string
			fg: string
	  }
	| undefined {
	if (!point) return undefined
	const conus = point.lat >= 24 && point.lat <= 50 && point.lon >= -125 && point.lon <= -66.5
	if (conus) {
		return {
			label: "NLDI first",
			title: "CONUS outlet: quick delineation tries NLDI/NHDPlus before MERIT fallback.",
			bg: "rgba(34,197,94,0.16)",
			fg: "#86efac",
		}
	}
	const uparea = numberProp(feature?.properties, ["uparea", "UPAREA", "upArea", "UpArea"])
	if (uparea && uparea > QUICK_DELINEATE_MAX_MERIT_UPAREA_KM2) {
		return {
			label: "Hybrid",
			title: "Large MERIT basin: use Delineate with agent so the MERIT-Basins hybrid workflow can run safely.",
			bg: "rgba(251,146,60,0.18)",
			fg: "#fdba74",
		}
	}
	if (uparea && uparea > 0) {
		return {
			label: "Quick MERIT",
			title: "Basin is within the interactive MERIT flowdir envelope.",
			bg: "rgba(56,189,248,0.16)",
			fg: "#7dd3fc",
		}
	}
	return {
		label: "Outlet check",
		title: "Click a MERIT river/catchment feature for better area-aware routing guidance.",
		bg: "rgba(148,163,184,0.18)",
		fg: "#cbd5e1",
	}
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
	onAddSelection,
	onClearSelection,
	onSaveFeatures,
	selectedFeatures = [],
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
	const badge = routingBadge(current, inspectPoint)
	const currentSelection = current?.geometry ? [current] : []
	const selectedCount = selectedFeatures.filter((feature) => feature.geometry).length

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
					{badge && (
						<div
							style={{
								display: "inline-flex",
								alignItems: "center",
								marginTop: 5,
								padding: "1px 6px",
								borderRadius: 3,
								background: badge.bg,
								color: badge.fg,
								fontSize: 8,
								fontWeight: 700,
								letterSpacing: 0,
								textTransform: "uppercase",
							}}
							title={badge.title}>
							{badge.label}
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
										title="Interactive MERIT flowdir delineation when the basin is within the raster safety envelope"
										type="button">
										{delineating ? "Delineating…" : "Quick delineate"}
									</button>
									<div style={{ marginTop: 4, fontSize: 8, color: muted, lineHeight: 1.35 }}>
										{delineating
											? "Delineating… (this may take several minutes)"
											: "Interactive MERIT routing for small and medium basins. Large basins need Delineate with agent for hybrid routing."}
									</div>
								</div>
							)}
							{currentSelection.length > 0 && (onAddSelection || onSaveFeatures) && (
								<div
									style={{
										marginTop: 8,
										paddingTop: 7,
										borderTop: `1px dashed ${bdClr}`,
										display: "grid",
										gridTemplateColumns: "1fr 1fr",
										gap: 4,
									}}>
									{onAddSelection && (
										<button
											onClick={() => onAddSelection(currentSelection)}
											style={{ ...secondaryBtn, marginTop: 0, fontSize: 9, padding: "4px 6px" }}
											title="Add this feature to the multi-selection set. Shift-click features on the map to add/remove quickly."
											type="button">
											Select
										</button>
									)}
									{onSaveFeatures && (
										<button
											onClick={() => void onSaveFeatures(currentSelection, "geojson")}
											style={{ ...secondaryBtn, marginTop: 0, fontSize: 9, padding: "4px 6px" }}
											title="Save this feature to workspace vectors/ as GeoJSON"
											type="button">
											GeoJSON
										</button>
									)}
									{onSaveFeatures && (
										<button
											onClick={() => void onSaveFeatures(currentSelection, "shapefile")}
											style={{ ...secondaryBtn, marginTop: 0, fontSize: 9, padding: "4px 6px" }}
											title="Save this feature to workspace vectors/ as a zipped shapefile"
											type="button">
											SHP
										</button>
									)}
									<div style={{ fontSize: 8, color: muted, lineHeight: 1.3, alignSelf: "center" }}>
										Shift-click map features to build a set.
									</div>
								</div>
							)}
							{selectedCount > 0 && onSaveFeatures && (
								<div
									style={{
										marginTop: 6,
										padding: 6,
										borderRadius: 4,
										background: isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)",
										border: `1px solid ${bdClr}`,
									}}>
									<div
										style={{
											display: "flex",
											alignItems: "center",
											gap: 6,
											marginBottom: 5,
											fontSize: 9,
											color: muted,
										}}>
										<span style={{ flex: 1 }}>{selectedCount} selected</span>
										{onClearSelection && (
											<button
												onClick={onClearSelection}
												style={{ ...btnStyle, width: 18, height: 18, fontSize: 9 }}
												title="Clear selected features"
												type="button">
												✕
											</button>
										)}
									</div>
									<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
										<button
											onClick={() => void onSaveFeatures(selectedFeatures, "geojson")}
											style={{ ...secondaryBtn, marginTop: 0, fontSize: 9, padding: "4px 6px" }}
											title="Save selected features as GeoJSON"
											type="button">
											Save GeoJSON
										</button>
										<button
											onClick={() => void onSaveFeatures(selectedFeatures, "shapefile")}
											style={{ ...secondaryBtn, marginTop: 0, fontSize: 9, padding: "4px 6px" }}
											title="Save selected features as a zipped shapefile"
											type="button">
											Save SHP
										</button>
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
