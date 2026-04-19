import type { MapLayer } from "@shared/proto/cline/map"
import { RemoveMapLayerRequest } from "@shared/proto/cline/map"
import React, { useState } from "react"
import { useMapContext } from "../../context/MapContext"
import { MapServiceClient } from "../../services/grpc-client"

interface LayerListProps {
	onZoomToLayer?: (layer: MapLayer) => void
	onVisibilityChange: (layerId: string, visible: boolean) => void
	visibleLayerIds: Set<string>
	mapStyle?: string
}

/**
 * LayerList component - displays and manages map layers
 * Features: visibility toggle, remove layer, zoom to extent
 */
const getLayerTypeIcon = (layerType?: string): string => {
	switch ((layerType || "").toLowerCase()) {
		case "point":
			return "●"
		case "line":
			return "〰"
		case "polygon":
			return "⬡"
		case "raster":
			return "▦"
		default:
			return "◈"
	}
}

export const LayerList: React.FC<LayerListProps> = ({
	onZoomToLayer,
	onVisibilityChange,
	visibleLayerIds,
	mapStyle = "dark",
}) => {
	const { layers } = useMapContext()
	const [collapsed, setCollapsed] = useState(false)
	const [confirmingClear, setConfirmingClear] = useState(false)

	const isDark = mapStyle === "dark"
	const bgColor = isDark ? "rgba(26, 26, 46, 0.95)" : "rgba(245, 245, 245, 0.95)"
	const textColor = isDark ? "#ffffff" : "#000000"
	const borderColor = isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.1)"

	// Separate workspace files from manual layers
	const workspaceLayers = layers.filter((l) => l.metadata?.source === "workspace")

	// Check if all workspace files are hidden or visible
	const allWorkspaceHidden = workspaceLayers.every((l) => !visibleLayerIds.has(l.id))
	const allWorkspaceVisible = workspaceLayers.every((l) => visibleLayerIds.has(l.id))

	const handleToggleVisibility = (layerId: string) => {
		const willBeVisible = !visibleLayerIds.has(layerId)
		onVisibilityChange(layerId, willBeVisible)
	}

	const handleShowAllWorkspace = () => {
		workspaceLayers.forEach((layer) => {
			onVisibilityChange(layer.id, true)
		})
	}

	const handleHideAllWorkspace = () => {
		workspaceLayers.forEach((layer) => {
			onVisibilityChange(layer.id, false)
		})
	}

	const handleRemoveLayer = async (layerId: string) => {
		try {
			// Remove from backend
			await MapServiceClient.removeMapLayer(RemoveMapLayerRequest.create({ layerId }))
		} catch (error) {
			console.error("Failed to remove layer:", error)
		}
	}

	const handleClearAll = async () => {
		try {
			await MapServiceClient.clearMapLayers({})
		} catch (error) {
			console.error("Failed to clear layers:", error)
		} finally {
			setConfirmingClear(false)
		}
	}

	const handleZoomTo = (layer: MapLayer) => {
		if (onZoomToLayer) {
			onZoomToLayer(layer)
		}
	}

	// Get layer color for visual indicator
	const getLayerColor = (layer: MapLayer): string => {
		if (layer.layerType === "raster") {
			// Show a gradient swatch representative of the colormap
			const cmap = layer.metadata?.raster_colormap ?? "viridis"
			const gradients: Record<string, string> = {
				viridis: "linear-gradient(to right, #440154, #31688e, #35b779, #fde725)",
				viridis_r: "linear-gradient(to right, #fde725, #35b779, #31688e, #440154)",
				YlOrRd: "linear-gradient(to right, #ffffb2, #fecc5c, #fd8d3c, #e31a1c)",
				Blues: "linear-gradient(to right, #f7fbff, #6baed6, #2171b5, #084594)",
				RdYlGn: "linear-gradient(to right, #d73027, #fee08b, #1a9850)",
			}
			return gradients[cmap] ?? "linear-gradient(to right, #440154, #fde725)"
		}
		return layer.style?.fillColor || layer.style?.color || "#0066CC"
	}

	if (layers.length === 0) {
		return null
	}

	return (
		<div
			style={{
				position: "absolute",
				top: "10px",
				left: "10px",
				background: bgColor,
				color: textColor,
				borderRadius: "4px",
				border: `1px solid ${borderColor}`,
				minWidth: "250px",
				maxWidth: "350px",
				maxHeight: "80vh",
				overflow: "hidden",
				display: "flex",
				flexDirection: "column",
				boxShadow: "0 2px 8px rgba(0, 0, 0, 0.3)",
				zIndex: 2,
			}}>
			{/* Header */}
			<div
				onClick={() => setCollapsed(!collapsed)}
				style={{
					padding: "12px",
					borderBottom: `1px solid ${borderColor}`,
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
					cursor: "pointer",
				}}>
				<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
					<span style={{ fontSize: "16px" }}>📑</span>
					<span style={{ fontWeight: "bold", fontSize: "14px" }}>Layers ({layers.length})</span>
				</div>
				<button
					onClick={(e) => {
						e.stopPropagation()
						setCollapsed(!collapsed)
					}}
					style={{
						background: "transparent",
						border: "none",
						color: textColor,
						cursor: "pointer",
						fontSize: "18px",
						padding: "4px",
						display: "flex",
						alignItems: "center",
					}}
					title={collapsed ? "Expand" : "Collapse"}>
					{collapsed ? "▼" : "▲"}
				</button>
			</div>

			{!collapsed && (
				<>
					{/* Layer list */}
					<div
						style={{
							flex: 1,
							overflowY: "auto",
							padding: "8px",
						}}>
						{layers.map((layer) => {
							const isVisible = visibleLayerIds.has(layer.id)
							const layerColor = getLayerColor(layer)

							return (
								<div
									key={layer.id}
									style={{
										padding: "8px",
										marginBottom: "4px",
										background: isDark ? "rgba(255, 255, 255, 0.05)" : "rgba(0, 0, 0, 0.03)",
										borderRadius: "4px",
										border: `1px solid ${borderColor}`,
										opacity: isVisible ? 1 : 0.5,
									}}>
									{/* Layer name and color indicator */}
									<div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px" }}>
										<div
											style={{
												width: layer.layerType === "raster" ? "28px" : "14px",
												height: "14px",
												borderRadius: "2px",
												background: layerColor,
												border: "1px solid rgba(255, 255, 255, 0.3)",
												flexShrink: 0,
											}}
										/>
										<span
											style={{ fontSize: "11px", opacity: 0.7, flexShrink: 0 }}
											title={`Layer type: ${layer.layerType || "unknown"}`}>
											{getLayerTypeIcon(layer.layerType)}
										</span>
										{/* Workspace file badge */}
										{layer.metadata?.source === "workspace" && (
											<span style={{ fontSize: "12px" }} title="Workspace file">
												📁
											</span>
										)}
										<span
											style={{
												fontSize: "13px",
												fontWeight: "500",
												flex: 1,
												overflow: "hidden",
												textOverflow: "ellipsis",
												whiteSpace: "nowrap",
											}}>
											{layer.name || layer.id}
										</span>
									</div>

									{/* Layer metadata — skip internal system keys */}
									{layer.metadata &&
										(() => {
											const entries = Object.entries(layer.metadata).filter(
												([k]) => k !== "__operation" && k !== "source",
											)
											return entries.length > 0 ? (
												<div style={{ fontSize: "11px", opacity: 0.7, marginBottom: "8px" }}>
													{entries.slice(0, 4).map(([key, value]) => (
														<div key={key}>
															<b>{key}:</b> {value}
														</div>
													))}
													{entries.length > 4 && (
														<div style={{ opacity: 0.6 }}>+{entries.length - 4} more</div>
													)}
												</div>
											) : null
										})()}

									{/* Controls */}
									<div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
										{/* Visibility toggle */}
										<label
											style={{
												display: "flex",
												alignItems: "center",
												gap: "4px",
												cursor: "pointer",
												fontSize: "12px",
											}}>
											<input
												checked={isVisible}
												onChange={() => handleToggleVisibility(layer.id)}
												style={{ cursor: "pointer" }}
												type="checkbox"
											/>
											<span>{isVisible ? "Visible" : "Hidden"}</span>
										</label>

										{/* Zoom to button */}
										<button
											onClick={() => handleZoomTo(layer)}
											style={{
												padding: "4px 8px",
												fontSize: "11px",
												background: isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.1)",
												border: `1px solid ${borderColor}`,
												borderRadius: "3px",
												color: textColor,
												cursor: "pointer",
											}}
											title="Zoom to layer extent">
											🔍
										</button>

										{/* Remove button */}
										<button
											onClick={() => handleRemoveLayer(layer.id)}
											style={{
												padding: "4px 8px",
												fontSize: "11px",
												background: "rgba(220, 53, 69, 0.1)",
												border: "1px solid rgba(220, 53, 69, 0.3)",
												borderRadius: "3px",
												color: "#dc3545",
												cursor: "pointer",
											}}
											title="Remove layer">
											✕
										</button>
									</div>
								</div>
							)
						})}
					</div>

					{/* Footer with workspace and clear all buttons */}
					<div
						style={{
							padding: "8px",
							borderTop: `1px solid ${borderColor}`,
							display: "flex",
							flexDirection: "column",
							gap: "8px",
						}}>
						{/* Workspace files control buttons */}
						{workspaceLayers.length > 0 && (
							<div style={{ display: "flex", gap: "8px" }}>
								<button
									disabled={allWorkspaceVisible}
									onClick={handleShowAllWorkspace}
									style={{
										flex: 1,
										padding: "8px",
										fontSize: "11px",
										background: isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.1)",
										border: `1px solid ${borderColor}`,
										borderRadius: "3px",
										color: textColor,
										cursor: allWorkspaceVisible ? "not-allowed" : "pointer",
										opacity: allWorkspaceVisible ? 0.5 : 1,
										fontWeight: "500",
									}}
									title="Show all workspace files">
									📁 Show All
								</button>
								<button
									disabled={allWorkspaceHidden}
									onClick={handleHideAllWorkspace}
									style={{
										flex: 1,
										padding: "8px",
										fontSize: "11px",
										background: isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.1)",
										border: `1px solid ${borderColor}`,
										borderRadius: "3px",
										color: textColor,
										cursor: allWorkspaceHidden ? "not-allowed" : "pointer",
										opacity: allWorkspaceHidden ? 0.5 : 1,
										fontWeight: "500",
									}}
									title="Hide all workspace files">
									📁 Hide All
								</button>
							</div>
						)}

						{/* Clear all layers — inline confirm (no window.confirm which is blocked in webviews) */}
						{layers.length > 1 &&
							(confirmingClear ? (
								<div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
									<span style={{ fontSize: "11px", flex: 1, color: isDark ? "#ffa0a0" : "#cc0000" }}>
										Remove all {layers.length} layers?
									</span>
									<button
										onClick={handleClearAll}
										style={{
											padding: "4px 10px",
											fontSize: "11px",
											fontWeight: "600",
											background: "rgba(220, 53, 69, 0.8)",
											border: "none",
											borderRadius: "3px",
											color: "#fff",
											cursor: "pointer",
										}}>
										Yes
									</button>
									<button
										onClick={() => setConfirmingClear(false)}
										style={{
											padding: "4px 10px",
											fontSize: "11px",
											background: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)",
											border: `1px solid ${borderColor}`,
											borderRadius: "3px",
											color: textColor,
											cursor: "pointer",
										}}>
										No
									</button>
								</div>
							) : (
								<button
									onClick={() => setConfirmingClear(true)}
									style={{
										width: "100%",
										padding: "8px",
										fontSize: "12px",
										background: "rgba(220, 53, 69, 0.1)",
										border: "1px solid rgba(220, 53, 69, 0.3)",
										borderRadius: "3px",
										color: "#dc3545",
										cursor: "pointer",
										fontWeight: "500",
									}}>
									Clear All Layers
								</button>
							))}
					</div>
				</>
			)}
		</div>
	)
}

export default LayerList
