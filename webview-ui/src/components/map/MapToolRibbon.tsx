/**
 * MapToolRibbon — single docked column of icons on the right edge of the map,
 * with a slide-out panel area. Replaces the previous pair of floating widgets
 * (basemap dropdown + collapsed layer button) with a unified surface.
 *
 *      ┌─────────┬───┐
 *      │         │ ▦ │  ← active panel (basemap / layers / future tools)
 *      │ active  │ 📑│
 *      │ panel   │ ⛶ │
 *      │         │   │
 *      └─────────┴───┘
 *
 * The ribbon is *always* visible. Clicking an icon toggles its panel; clicking
 * an already-active icon collapses it. Only one panel is open at a time. When
 * everything is collapsed, only the icon strip is shown — the map gets the
 * full canvas.
 *
 * Tools today: Basemap, Layers. Future: Measure, Tools/Plugins, Settings.
 */

import type { MapLayer } from "@shared/proto/cline/map"
import React, { useState } from "react"
import { BasemapList } from "./BaseMapSelector"
import { LayerPanelContent } from "./LayerPanel"

export type RibbonTool = "basemap" | "layers" | null

interface MapToolRibbonProps {
	mapStyle: "dark" | "light"
	currentBasemap: string
	onBasemapChange: (id: string) => void
	hasMapboxToken?: boolean
	visibleLayerIds: Set<string>
	onVisibilityChange: (layerId: string, visible: boolean) => void
	onZoomToLayer?: (layer: MapLayer) => void
	layerOrder: string[]
	onReorder: (newOrder: string[]) => void
	layerCount: number
}

export const MapToolRibbon: React.FC<MapToolRibbonProps> = ({
	mapStyle,
	currentBasemap,
	onBasemapChange,
	hasMapboxToken,
	visibleLayerIds,
	onVisibilityChange,
	onZoomToLayer,
	layerOrder,
	onReorder,
	layerCount,
}) => {
	const [active, setActive] = useState<RibbonTool>(null)
	const [panelWidth, setPanelWidth] = useState<number>(active === "layers" ? 300 : 220)

	const isDark = mapStyle === "dark"
	const fg = isDark ? "var(--vscode-foreground, #ddd)" : "var(--vscode-foreground, #222)"
	const bg = isDark ? "rgba(20,20,28,0.96)" : "rgba(248,248,250,0.97)"
	const border = isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.12)"
	const subtle = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)"
	const accent = "var(--vscode-button-background, #0e639c)"

	const toggle = (tool: RibbonTool) => setActive((cur) => (cur === tool ? null : tool))

	const onResizeStart = (e: React.MouseEvent) => {
		e.preventDefault()
		const startX = e.clientX
		const startW = panelWidth
		const onMove = (ev: MouseEvent) => {
			const next = Math.max(220, Math.min(520, startW + (startX - ev.clientX)))
			setPanelWidth(next)
		}
		const onUp = () => {
			window.removeEventListener("mousemove", onMove)
			window.removeEventListener("mouseup", onUp)
		}
		window.addEventListener("mousemove", onMove)
		window.addEventListener("mouseup", onUp)
	}

	const ribbonWidth = 40
	const totalWidth = active ? panelWidth + ribbonWidth : ribbonWidth

	return (
		<div
			style={{
				position: "absolute",
				top: 10,
				right: 10,
				bottom: 36, // leave room for status bar
				zIndex: 5,
				width: totalWidth,
				display: "flex",
				flexDirection: "row",
				gap: 0,
				pointerEvents: "none",
				fontFamily: "var(--vscode-font-family, system-ui, sans-serif)",
			}}>
			{/* Active panel — slides in to the LEFT of the icon strip */}
			{active && (
				<div
					style={{
						width: panelWidth,
						background: bg,
						color: fg,
						border: `1px solid ${border}`,
						borderRight: "none",
						borderTopLeftRadius: 6,
						borderBottomLeftRadius: 6,
						boxShadow: "0 4px 16px rgba(0,0,0,0.30)",
						display: "flex",
						flexDirection: "column",
						overflow: "hidden",
						pointerEvents: "auto",
						position: "relative",
					}}>
					{/* Resize gripper on the left edge */}
					<div
						aria-label="Resize panel"
						onMouseDown={onResizeStart}
						role="separator"
						style={{
							position: "absolute",
							left: 0,
							top: 0,
							bottom: 0,
							width: 4,
							cursor: "ew-resize",
							zIndex: 1,
						}}
						title="Drag to resize"
					/>

					{/* Panel header */}
					<div
						style={{
							padding: "8px 10px",
							borderBottom: `1px solid ${border}`,
							display: "flex",
							alignItems: "center",
							gap: 8,
							background: subtle,
						}}>
						<span style={{ fontSize: 14 }}>{active === "basemap" ? "🗺️" : "📑"}</span>
						<span style={{ fontWeight: 600, fontSize: 13, flex: 1 }}>
							{active === "basemap" ? "Basemap" : `Layers (${layerCount})`}
						</span>
						<button
							aria-label="Close panel"
							onClick={() => setActive(null)}
							style={{
								background: "transparent",
								color: fg,
								border: "none",
								borderRadius: 3,
								padding: "2px 6px",
								cursor: "pointer",
								fontSize: 13,
								lineHeight: 1,
							}}
							title="Close"
							type="button">
							✕
						</button>
					</div>

					{/* Panel content — scrollable */}
					<div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", minHeight: 0 }}>
						{active === "basemap" && (
							<BasemapList
								currentStyle={currentBasemap}
								hasMapboxToken={hasMapboxToken}
								mapStyle={mapStyle}
								onStyleChange={onBasemapChange}
							/>
						)}
						{active === "layers" && (
							<LayerPanelContent
								layerOrder={layerOrder}
								mapStyle={mapStyle}
								onReorder={onReorder}
								onVisibilityChange={onVisibilityChange}
								onZoomToLayer={onZoomToLayer}
								visibleLayerIds={visibleLayerIds}
							/>
						)}
					</div>
				</div>
			)}

			{/* Icon ribbon — always visible */}
			<div
				style={{
					width: ribbonWidth,
					background: bg,
					color: fg,
					border: `1px solid ${border}`,
					borderRadius: active ? "0 6px 6px 0" : 6,
					boxShadow: "0 2px 6px rgba(0,0,0,0.25)",
					display: "flex",
					flexDirection: "column",
					alignItems: "center",
					padding: "6px 0",
					gap: 4,
					pointerEvents: "auto",
					alignSelf: "flex-start",
				}}>
				<RibbonButton
					accent={accent}
					active={active === "basemap"}
					fg={fg}
					icon="🗺️"
					label="Basemap"
					onClick={() => toggle("basemap")}
				/>
				<RibbonButton
					accent={accent}
					active={active === "layers"}
					badge={layerCount > 0 ? layerCount : undefined}
					fg={fg}
					icon="📑"
					label={layerCount > 0 ? `Layers (${layerCount})` : "Layers"}
					onClick={() => toggle("layers")}
				/>
			</div>
		</div>
	)
}

interface RibbonButtonProps {
	icon: string
	label: string
	active: boolean
	accent: string
	fg: string
	onClick: () => void
	badge?: number
}

const RibbonButton: React.FC<RibbonButtonProps> = ({ icon, label, active, accent, fg, onClick, badge }) => (
	<button
		aria-label={label}
		onClick={onClick}
		style={{
			width: 32,
			height: 32,
			padding: 0,
			border: active ? `1px solid ${accent}` : "1px solid transparent",
			borderRadius: 4,
			background: active ? "rgba(14,99,156,0.18)" : "transparent",
			color: fg,
			cursor: "pointer",
			fontSize: 18,
			display: "flex",
			alignItems: "center",
			justifyContent: "center",
			position: "relative",
			fontFamily: "inherit",
		}}
		title={label}
		type="button">
		<span aria-hidden="true">{icon}</span>
		{badge !== undefined && (
			<span
				style={{
					position: "absolute",
					top: -2,
					right: -2,
					minWidth: 14,
					height: 14,
					padding: "0 3px",
					borderRadius: 7,
					background: accent,
					color: "#fff",
					fontSize: 9,
					fontWeight: 700,
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					fontVariantNumeric: "tabular-nums",
					boxShadow: "0 1px 2px rgba(0,0,0,0.4)",
				}}>
				{badge > 99 ? "99+" : badge}
			</span>
		)}
	</button>
)

export default MapToolRibbon
