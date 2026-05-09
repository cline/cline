import React, { useState } from "react"

export interface ClickedFeature {
	layerId: string
	layerName: string
	properties: Record<string, unknown>
}

interface FeatureIdentifierProps {
	features: ClickedFeature[]
	mapStyle: string
	onClose: () => void
}

const FeatureIdentifier: React.FC<FeatureIdentifierProps> = ({ features, mapStyle, onClose }) => {
	const [currentIndex, setCurrentIndex] = useState(0)

	if (features.length === 0) {
		return null
	}

	const current = features[currentIndex]
	const isDark = mapStyle === "dark"
	const bg = isDark ? "rgba(30,30,30,0.95)" : "rgba(248,248,248,0.95)"
	const fg = isDark ? "rgba(255,255,255,0.90)" : "rgba(0,0,0,0.90)"
	const bdClr = isDark ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.18)"
	const accentBg = isDark ? "rgba(14,99,156,0.25)" : "rgba(14,99,156,0.12)"
	const accentText = isDark ? "#6ab7ff" : "#0e639c"

	const entries = Object.entries(current.properties)
		.filter(([k]) => !k.startsWith("_"))
		.slice(0, 12)
	const extra = Object.entries(current.properties).filter(([k]) => !k.startsWith("_")).length - entries.length

	const handlePrev = () => {
		setCurrentIndex((i) => (i === 0 ? features.length - 1 : i - 1))
	}

	const handleNext = () => {
		setCurrentIndex((i) => (i === features.length - 1 ? 0 : i + 1))
	}

	return (
		<div
			style={{
				position: "absolute",
				top: 12,
				right: 12,
				zIndex: 5,
				width: 300,
				maxHeight: "65vh",
				overflowY: "auto",
				background: bg,
				border: `1px solid ${bdClr}`,
				borderRadius: 6,
				boxShadow: "0 4px 12px rgba(0,0,0,0.35)",
				fontFamily: "var(--vscode-font-family, system-ui, sans-serif)",
				fontSize: 12,
				color: fg,
				pointerEvents: "auto",
			}}>
			{/* Header with layer name and stack indicator */}
			<div
				style={{
					padding: "8px 12px",
					borderBottom: `1px solid ${bdClr}`,
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					gap: 8,
				}}>
				<div style={{ flex: 1, minWidth: 0 }}>
					<div style={{ fontSize: 10, opacity: 0.65 }}>Layer</div>
					<div
						style={{
							fontSize: 13,
							fontWeight: 600,
							overflow: "hidden",
							textOverflow: "ellipsis",
							whiteSpace: "nowrap",
						}}>
						{current.layerName}
					</div>
				</div>

				{/* Stack indicator and navigation */}
				{features.length > 1 && (
					<div style={{ display: "flex", alignItems: "center", gap: 4 }}>
						<button
							onClick={handlePrev}
							style={{
								width: 24,
								height: 24,
								padding: 0,
								border: `1px solid ${bdClr}`,
								background: "transparent",
								color: fg,
								cursor: "pointer",
								borderRadius: 3,
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								fontSize: 10,
								opacity: 0.8,
							}}
							title="Previous feature"
							type="button">
							←
						</button>
						<div style={{ fontSize: 10, opacity: 0.65, minWidth: 24, textAlign: "center" }}>
							{currentIndex + 1}/{features.length}
						</div>
						<button
							onClick={handleNext}
							style={{
								width: 24,
								height: 24,
								padding: 0,
								border: `1px solid ${bdClr}`,
								background: "transparent",
								color: fg,
								cursor: "pointer",
								borderRadius: 3,
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								fontSize: 10,
								opacity: 0.8,
							}}
							title="Next feature"
							type="button">
							→
						</button>
					</div>
				)}
			</div>

			{/* Attributes */}
			<div style={{ padding: "8px 12px", maxHeight: "calc(65vh - 80px)", overflowY: "auto" }}>
				{entries.length === 0 ? (
					<div style={{ fontSize: 11, opacity: 0.55, fontStyle: "italic" }}>No attributes</div>
				) : (
					entries.map(([key, value]) => (
						<div
							key={key}
							style={{
								marginBottom: 6,
								paddingBottom: 6,
								borderBottom: `1px solid ${accentBg}`,
								fontSize: 11,
							}}>
							<div style={{ opacity: 0.65, marginBottom: 2, fontWeight: 500 }}>{key}</div>
							<div
								style={{
									background: accentBg,
									padding: "4px 6px",
									borderRadius: 3,
									wordBreak: "break-word",
									fontFamily: "var(--vscode-editor-font-family, monospace)",
									fontSize: 10,
									color: accentText,
									maxHeight: 60,
									overflowY: "auto",
								}}>
								{String(value ?? "—")}
							</div>
						</div>
					))
				)}
				{extra > 0 && (
					<div style={{ fontSize: 10, opacity: 0.55, marginTop: 6, fontStyle: "italic" }}>+{extra} more attributes</div>
				)}
			</div>

			{/* Close button */}
			<div
				style={{
					padding: "6px 12px",
					borderTop: `1px solid ${bdClr}`,
					display: "flex",
					justifyContent: "flex-end",
				}}>
				<button
					onClick={onClose}
					style={{
						padding: "4px 12px",
						fontSize: 11,
						border: `1px solid ${bdClr}`,
						background: "transparent",
						color: fg,
						cursor: "pointer",
						borderRadius: 3,
						opacity: 0.8,
					}}
					type="button">
					Close
				</button>
			</div>
		</div>
	)
}

export default FeatureIdentifier
