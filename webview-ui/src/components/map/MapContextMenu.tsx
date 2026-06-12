import React, { useEffect, useRef, useState } from "react"
import type { ClickedFeature } from "./FeatureIdentifier"

export type FeatureContext = "watershed" | "river" | "feature" | "empty"

function detectContext(features: ClickedFeature[]): FeatureContext {
	if (features.length === 0) return "empty"
	const props = features[0].properties
	if (props.area_km2 != null && (props.method != null || props.pfaf != null || props.routing != null)) return "watershed"
	if (props.uparea != null || props.strmOrder != null || props.COMID != null || props.comid != null) return "river"
	return "feature"
}

function fmtArea(km2: number): string {
	return km2 >= 1000 ? `${(km2 / 1000).toFixed(1)} ×10³ km²` : `${km2.toFixed(0)} km²`
}

export interface MapContextMenuProps {
	x: number
	y: number
	lon: number
	lat: number
	features: ClickedFeature[]
	mapStyle: string
	agentStarting?: boolean
	delineating?: boolean
	onAskAiHydro: (question: string) => void
	onAgentDelineate: () => void
	onQuickDelineate: () => void
	onAddAnnotation: () => void
	onMeasureFrom: () => void
	onCopyCoords: () => void
	onInspect: () => void
	onSaveFeature: (format: "geojson" | "shapefile") => void
	onRemoveLayer?: () => void
	onClose: () => void
}

const MapContextMenu: React.FC<MapContextMenuProps> = ({
	x,
	y,
	lon,
	lat,
	features,
	mapStyle,
	agentStarting = false,
	delineating = false,
	onAskAiHydro,
	onAgentDelineate,
	onQuickDelineate,
	onAddAnnotation,
	onMeasureFrom,
	onCopyCoords,
	onInspect,
	onSaveFeature,
	onRemoveLayer,
	onClose,
}) => {
	const [askOpen, setAskOpen] = useState(false)
	const [question, setQuestion] = useState("")
	const [copiedFeedback, setCopiedFeedback] = useState(false)
	const textareaRef = useRef<HTMLTextAreaElement>(null)

	const ctx = detectContext(features)
	const primary = features[0]
	const props = primary?.properties ?? {}
	const busy = agentStarting || delineating

	const isDark = mapStyle === "dark"
	const bg = isDark ? "rgba(20,20,28,0.97)" : "rgba(252,252,252,0.97)"
	const fg = isDark ? "rgba(255,255,255,0.92)" : "rgba(0,0,0,0.88)"
	const bdClr = isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.11)"
	const muted = isDark ? "rgba(255,255,255,0.50)" : "rgba(0,0,0,0.50)"
	const accentText = isDark ? "#7ec8ff" : "#0e639c"
	const accentBg = isDark ? "rgba(30,90,140,0.60)" : "rgba(14,99,156,0.16)"
	const hoverBg = isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.05)"
	const dangerText = isDark ? "#f87171" : "#dc2626"

	const latStr = `${Math.abs(lat).toFixed(5)}°${lat >= 0 ? "N" : "S"}`
	const lonStr = `${Math.abs(lon).toFixed(5)}°${lon >= 0 ? "E" : "W"}`
	const coordLine = `${latStr}, ${lonStr}`

	const ctxMeta = {
		watershed: { icon: "🌊", label: "Watershed", color: isDark ? "#fbbf24" : "#d97706" },
		river: { icon: "〰️", label: "Stream / River", color: isDark ? "#7ec8ff" : "#0e639c" },
		feature: { icon: "📌", label: primary?.layerName ?? "Feature", color: isDark ? "#a78bfa" : "#7c3aed" },
		empty: { icon: "🗺️", label: "Map", color: muted },
	}[ctx]

	useEffect(() => {
		if (askOpen) textareaRef.current?.focus()
	}, [askOpen])

	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return
			if (askOpen) {
				setAskOpen(false)
				setQuestion("")
			} else onClose()
			e.stopPropagation()
		}
		window.addEventListener("keydown", handler, true)
		return () => window.removeEventListener("keydown", handler, true)
	}, [askOpen, onClose])

	const handleCopy = () => {
		void navigator.clipboard.writeText(coordLine)
		onCopyCoords()
		setCopiedFeedback(true)
		setTimeout(() => {
			setCopiedFeedback(false)
			onClose()
		}, 900)
	}

	const act = (fn: () => void) => () => {
		fn()
		onClose()
	}

	// Shared styles
	const item = (extra?: React.CSSProperties): React.CSSProperties => ({
		display: "flex",
		alignItems: "center",
		gap: 8,
		width: "100%",
		padding: "6px 11px",
		background: "transparent",
		border: "none",
		color: fg,
		cursor: "pointer",
		fontSize: 11.5,
		textAlign: "left",
		lineHeight: 1.3,
		...extra,
	})
	const icon: React.CSSProperties = { width: 16, flexShrink: 0, fontSize: 13, textAlign: "center" }
	const divider: React.CSSProperties = { height: 1, background: bdClr, margin: "2px 0" }

	const Btn = ({
		emoji,
		label,
		onClick,
		color,
		disabled,
		title,
	}: {
		emoji: string
		label: string
		onClick: () => void
		color?: string
		disabled?: boolean
		title?: string
	}) => (
		<button
			disabled={disabled}
			onClick={onClick}
			onMouseEnter={(e) => !disabled && ((e.currentTarget as HTMLElement).style.background = hoverBg)}
			onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "transparent")}
			style={item({
				color: disabled ? muted : (color ?? fg),
				cursor: disabled ? "not-allowed" : "pointer",
				opacity: disabled ? 0.55 : 1,
			})}
			title={title}
			type="button">
			<span style={icon}>{emoji}</span>
			{label}
		</button>
	)

	return (
		<div
			onClick={(e) => e.stopPropagation()}
			onMouseDown={(e) => e.stopPropagation()}
			style={{
				position: "absolute",
				left: x,
				top: y,
				zIndex: 20,
				minWidth: 200,
				maxWidth: 248,
				background: bg,
				border: `1px solid ${bdClr}`,
				borderRadius: 8,
				boxShadow: "0 6px 20px rgba(0,0,0,0.40)",
				fontFamily: "var(--vscode-font-family, system-ui, sans-serif)",
				fontSize: 11.5,
				color: fg,
				pointerEvents: "auto",
				userSelect: "none",
				overflow: "hidden",
			}}>
			{/* ── Header ── */}
			<div style={{ padding: "7px 11px 5px", borderBottom: `1px solid ${bdClr}` }}>
				<div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 2 }}>
					<span style={{ fontSize: 12 }}>{ctxMeta.icon}</span>
					<span style={{ fontWeight: 700, fontSize: 11, color: ctxMeta.color }}>{ctxMeta.label}</span>
					{ctx === "watershed" && props.area_km2 != null && (
						<span style={{ marginLeft: "auto", fontSize: 10, color: accentText, fontFamily: "monospace" }}>
							{fmtArea(Number(props.area_km2))}
						</span>
					)}
					{ctx === "river" && props.uparea != null && (
						<span style={{ marginLeft: "auto", fontSize: 10, color: accentText, fontFamily: "monospace" }}>
							↑{Number(props.uparea).toFixed(0)} km²
						</span>
					)}
				</div>
				<div style={{ fontSize: 9, color: muted, fontFamily: "monospace", lineHeight: 1.3 }}>{coordLine}</div>
			</div>

			{/* ── Ask AI-Hydro ── */}
			<div style={{ padding: "4px 0 2px" }}>
				{!askOpen ? (
					<Btn
						color={accentText}
						emoji="✦"
						label={
							ctx === "watershed"
								? "Ask AI-Hydro about this basin…"
								: ctx === "river"
									? "Ask AI-Hydro about this stream…"
									: ctx === "feature"
										? "Ask AI-Hydro about this feature…"
										: "Ask AI-Hydro about this location…"
						}
						onClick={() => setAskOpen(true)}
					/>
				) : (
					<div style={{ padding: "4px 10px 8px" }}>
						<div style={{ fontSize: 9, color: muted, marginBottom: 4 }}>
							{ctx === "watershed"
								? "e.g. What does this basin's Pfaf code indicate?"
								: ctx === "river"
									? "e.g. What is the stream order and flood potential?"
									: "e.g. What's the hydrology context here?"}
						</div>
						<textarea
							onChange={(e) => setQuestion(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter" && !e.shiftKey) {
									e.preventDefault()
									onAskAiHydro(question.trim())
									onClose()
								}
							}}
							placeholder="Type a question…"
							ref={textareaRef}
							rows={3}
							style={{
								width: "100%",
								boxSizing: "border-box",
								resize: "none",
								background: isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.05)",
								border: `1px solid ${bdClr}`,
								borderRadius: 4,
								color: fg,
								fontFamily: "var(--vscode-font-family, system-ui, sans-serif)",
								fontSize: 11,
								padding: "4px 6px",
								outline: "none",
							}}
							value={question}
						/>
						<div style={{ display: "flex", gap: 5, marginTop: 5 }}>
							<button
								disabled={busy}
								onClick={() => {
									onAskAiHydro(question.trim())
									onClose()
								}}
								style={{
									flex: 1,
									padding: "4px 6px",
									fontSize: 10,
									fontWeight: 700,
									background: accentBg,
									color: accentText,
									border: `1px solid ${bdClr}`,
									borderRadius: 4,
									cursor: busy ? "wait" : "pointer",
									opacity: busy ? 0.7 : 1,
								}}
								type="button">
								{agentStarting ? "Opening…" : "Send ↵"}
							</button>
							<button
								onClick={() => {
									setAskOpen(false)
									setQuestion("")
								}}
								style={{
									padding: "4px 8px",
									fontSize: 10,
									background: "transparent",
									color: muted,
									border: `1px solid ${bdClr}`,
									borderRadius: 4,
									cursor: "pointer",
								}}
								type="button">
								✕
							</button>
						</div>
					</div>
				)}
			</div>

			<div style={divider} />

			{/* ── Context-aware primary actions ── */}
			{ctx === "watershed" && (
				<div style={{ padding: "3px 0" }}>
					<Btn emoji="🔍" label="Inspect watershed details" onClick={act(onInspect)} />
					<Btn
						disabled={busy}
						emoji="🌊"
						label="Delineate sub-basin here"
						onClick={act(onAgentDelineate)}
						title="Use agent to delineate a nested sub-basin at this outlet"
					/>
					<Btn emoji="📄" label="Export GeoJSON" onClick={act(() => onSaveFeature("geojson"))} />
					<Btn emoji="🗂️" label="Export Shapefile" onClick={act(() => onSaveFeature("shapefile"))} />
					{onRemoveLayer && (
						<Btn
							color={dangerText}
							emoji="🗑️"
							label="Remove layer from map"
							onClick={act(onRemoveLayer)}
							title="Remove this watershed layer from the map"
						/>
					)}
				</div>
			)}

			{ctx === "river" && (
				<div style={{ padding: "3px 0" }}>
					<Btn
						color={accentText}
						disabled={busy}
						emoji="🌊"
						label="Delineate watershed here"
						onClick={act(onAgentDelineate)}
					/>
					<Btn
						disabled={busy}
						emoji="⚡"
						label="Quick delineate"
						onClick={act(onQuickDelineate)}
						title="Interactive MERIT routing — fast for small / medium basins"
					/>
					<Btn emoji="🔍" label="Inspect stream attributes" onClick={act(onInspect)} />
					<Btn emoji="📄" label="Export segment (GeoJSON)" onClick={act(() => onSaveFeature("geojson"))} />
					{onRemoveLayer && (
						<Btn color={dangerText} emoji="🗑️" label="Remove layer from map" onClick={act(onRemoveLayer)} />
					)}
				</div>
			)}

			{ctx === "feature" && (
				<div style={{ padding: "3px 0" }}>
					<Btn emoji="🔍" label="Inspect feature" onClick={act(onInspect)} />
					<Btn disabled={busy} emoji="🌊" label="Delineate watershed here" onClick={act(onAgentDelineate)} />
					<Btn emoji="📄" label="Save as GeoJSON" onClick={act(() => onSaveFeature("geojson"))} />
					<Btn emoji="🗂️" label="Save as Shapefile" onClick={act(() => onSaveFeature("shapefile"))} />
					{onRemoveLayer && (
						<Btn color={dangerText} emoji="🗑️" label="Remove layer from map" onClick={act(onRemoveLayer)} />
					)}
				</div>
			)}

			{ctx === "empty" && (
				<div style={{ padding: "3px 0" }}>
					<Btn
						color={accentText}
						emoji="📍"
						label="Drop pin here"
						onClick={act(onAddAnnotation)}
						title="Same as double-clicking — drops a point annotation"
					/>
					<Btn disabled={busy} emoji="🌊" label="Delineate watershed here" onClick={act(onAgentDelineate)} />
					<Btn disabled={busy} emoji="⚡" label="Quick delineate" onClick={act(onQuickDelineate)} />
				</div>
			)}

			<div style={divider} />

			{/* ── Universal utility actions ── */}
			<div style={{ padding: "3px 0 4px" }}>
				<Btn emoji="📏" label="Measure from here" onClick={act(onMeasureFrom)} />
				<Btn emoji="🏷️" label="Add annotation here" onClick={act(onAddAnnotation)} />
				<Btn
					color={copiedFeedback ? accentText : undefined}
					emoji={copiedFeedback ? "✓" : "📋"}
					label={copiedFeedback ? "Copied!" : "Copy coordinates"}
					onClick={handleCopy}
				/>
			</div>

			{/* ── Double-click hint ── */}
			<div
				style={{ padding: "3px 11px 6px", borderTop: `1px solid ${bdClr}`, fontSize: 9, color: muted, lineHeight: 1.35 }}>
				Tip: double-click anywhere to drop a pin instantly
			</div>
		</div>
	)
}

export default MapContextMenu
