import type { MapLayer } from "@shared/proto/cline/map"
import React from "react"

interface SwipePanelProps {
	layers: MapLayer[]
	visibleLayerIds: Set<string>
	swipeMode: boolean
	setSwipeMode: (v: boolean) => void
	swipeLayerLeft: string | null
	setSwipeLayerLeft: (id: string | null) => void
	swipeLayerRight: string | null
	setSwipeLayerRight: (id: string | null) => void
	swipeX: number
	setSwipeX: (v: number) => void
}

export const SwipePanel: React.FC<SwipePanelProps> = ({
	layers,
	visibleLayerIds,
	swipeMode,
	setSwipeMode,
	swipeLayerLeft,
	setSwipeLayerLeft,
	swipeLayerRight,
	setSwipeLayerRight,
	swipeX,
	setSwipeX,
}) => {
	const visibleLayers = layers.filter((l) => visibleLayerIds.has(l.id))

	const handleSwap = () => {
		const tmp = swipeLayerLeft
		setSwipeLayerLeft(swipeLayerRight)
		setSwipeLayerRight(tmp)
	}

	const positionPct = Math.round(swipeX * 100)

	const selectStyle: React.CSSProperties = {
		fontSize: 11,
		padding: "3px 6px",
		background: "var(--vscode-input-background)",
		color: "var(--vscode-input-foreground)",
		border: "1px solid var(--vscode-input-border)",
		borderRadius: 3,
		width: "100%",
	}

	const labelStyle: React.CSSProperties = {
		fontSize: 10,
		fontWeight: 600,
		opacity: 0.75,
		marginBottom: 3,
		display: "block",
	}

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
			<div style={{ fontSize: 11, opacity: 0.8, lineHeight: 1.5 }}>
				Compare two layers side-by-side using a draggable divider. Basemap, annotations, and transects stay visible on
				both sides.
			</div>

			<label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 11, fontWeight: 600 }}>
				<input checked={swipeMode} onChange={(e) => setSwipeMode(e.target.checked)} type="checkbox" />
				Enable Swipe Tool
			</label>

			{swipeMode && (
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						gap: 10,
						padding: 10,
						background: "rgba(0,0,0,0.08)",
						borderRadius: 6,
					}}>
					{/* Left layer */}
					<div>
						<span style={labelStyle}>◀ Left Layer</span>
						<select
							onChange={(e) => setSwipeLayerLeft(e.target.value || null)}
							style={selectStyle}
							value={swipeLayerLeft || ""}>
							<option value="">(Basemap only)</option>
							{visibleLayers.map((l) => (
								<option key={l.id} value={l.id}>
									{l.name}
								</option>
							))}
						</select>
					</div>

					{/* Swap button */}
					<div style={{ display: "flex", alignItems: "center", gap: 6 }}>
						<div style={{ flex: 1, height: 1, background: "rgba(128,128,128,0.3)" }} />
						<button
							onClick={handleSwap}
							style={{
								fontSize: 13,
								padding: "2px 10px",
								background: "var(--vscode-button-secondaryBackground)",
								color: "var(--vscode-button-secondaryForeground)",
								border: "1px solid var(--vscode-button-border, rgba(128,128,128,0.4))",
								borderRadius: 4,
								cursor: "pointer",
								display: "flex",
								alignItems: "center",
								gap: 4,
							}}
							title="Swap left and right layers">
							⇄ <span style={{ fontSize: 10 }}>Swap</span>
						</button>
						<div style={{ flex: 1, height: 1, background: "rgba(128,128,128,0.3)" }} />
					</div>

					{/* Right layer */}
					<div>
						<span style={labelStyle}>Right Layer ▶</span>
						<select
							onChange={(e) => setSwipeLayerRight(e.target.value || null)}
							style={selectStyle}
							value={swipeLayerRight || ""}>
							<option value="">(Basemap only)</option>
							{visibleLayers.map((l) => (
								<option key={l.id} value={l.id}>
									{l.name}
								</option>
							))}
						</select>
					</div>

					{/* Divider position control */}
					<div style={{ borderTop: "1px solid rgba(128,128,128,0.2)", paddingTop: 8 }}>
						<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
							<span style={{ ...labelStyle, marginBottom: 0 }}>Divider position</span>
							<span style={{ fontSize: 10, fontWeight: 700, opacity: 0.9 }}>{positionPct}%</span>
						</div>
						<input
							max={95}
							min={5}
							onChange={(e) => setSwipeX(Number(e.target.value) / 100)}
							style={{ width: "100%", cursor: "pointer" }}
							type="range"
							value={positionPct}
						/>
						<div style={{ display: "flex", justifyContent: "center", marginTop: 6 }}>
							<button
								onClick={() => setSwipeX(0.5)}
								style={{
									fontSize: 10,
									padding: "2px 10px",
									background: "var(--vscode-button-secondaryBackground)",
									color: "var(--vscode-button-secondaryForeground)",
									border: "1px solid var(--vscode-button-border, rgba(128,128,128,0.4))",
									borderRadius: 4,
									cursor: "pointer",
								}}
								title="Reset divider to center">
								⟵ Center ⟶
							</button>
						</div>
					</div>

					{/* Keyboard hint */}
					<div style={{ fontSize: 10, opacity: 0.55, textAlign: "center", lineHeight: 1.5 }}>
						← → arrow keys nudge divider · double-click handle to center
					</div>
				</div>
			)}
		</div>
	)
}

export default SwipePanel
