import { useState, useCallback } from "react"
import { useCopyToClipboard } from "@src/utils/clipboard"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { vscode } from "@src/utils/vscode"
import { MermaidActionButtons } from "./MermaidActionButtons"
import { Modal } from "./Modal"
import { TabButton } from "./TabButton"
import { IconButton } from "./IconButton"
import { ZoomControls } from "./ZoomControls"
import { StandardTooltip } from "@/components/ui"

const MIN_ZOOM = 0.5
const MAX_ZOOM = 20

export interface ImageViewerProps {
	imageUri: string // The URI to use for rendering (webview URI, base64, or regular URL)
	imagePath?: string // The actual file path for display and opening
	alt?: string
	showControls?: boolean
	className?: string
}

export function ImageViewer({
	imageUri,
	imagePath,
	alt = "Generated image",
	showControls = true,
	className = "",
}: ImageViewerProps) {
	const [showModal, setShowModal] = useState(false)
	const [zoomLevel, setZoomLevel] = useState(1)
	const [copyFeedback, setCopyFeedback] = useState(false)
	const [isHovering, setIsHovering] = useState(false)
	const [isDragging, setIsDragging] = useState(false)
	const [dragPosition, setDragPosition] = useState({ x: 0, y: 0 })
	const [imageError, setImageError] = useState<string | null>(null)
	const { copyWithFeedback } = useCopyToClipboard()
	const { t } = useAppTranslation()

	/**
	 * Opens a modal with the image for zooming
	 */
	const handleZoom = async (e: React.MouseEvent) => {
		e.stopPropagation()
		setShowModal(true)
		setZoomLevel(1)
		setDragPosition({ x: 0, y: 0 })
	}

	/**
	 * Copies the image path to clipboard
	 */
	const handleCopy = async (e: React.MouseEvent) => {
		e.stopPropagation()

		try {
			// Copy the file path if available
			if (imagePath) {
				await copyWithFeedback(imagePath, e)
				// Show feedback
				setCopyFeedback(true)
				setTimeout(() => setCopyFeedback(false), 2000)
			}
		} catch (err) {
			console.error("Error copying:", err instanceof Error ? err.message : String(err))
		}
	}

	/**
	 * Saves the image as a file
	 */
	const handleSave = async (e: React.MouseEvent) => {
		e.stopPropagation()

		try {
			// Request VSCode to save the image
			vscode.postMessage({
				type: "saveImage",
				dataUri: imageUri,
			})
		} catch (error) {
			console.error("Error saving image:", error)
		}
	}

	/**
	 * Opens the image in VS Code's image viewer
	 */
	const handleOpenInEditor = (e: React.MouseEvent) => {
		e.stopPropagation()
		// Use openImage for both file paths and data URIs
		// The backend will handle both cases appropriately
		if (imagePath) {
			// Use the actual file path for opening
			vscode.postMessage({
				type: "openImage",
				text: imagePath,
			})
		} else if (imageUri) {
			// Fallback to opening image URI if no path is available (for Mermaid diagrams)
			vscode.postMessage({
				type: "openImage",
				text: imageUri,
			})
		}
	}

	/**
	 * Adjust zoom level in the modal
	 */
	const adjustZoom = (amount: number) => {
		setZoomLevel((prev) => {
			const newZoom = prev + amount
			return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom))
		})
	}

	/**
	 * Handle wheel event for zooming with scroll wheel
	 */
	const handleWheel = useCallback((e: React.WheelEvent) => {
		e.preventDefault()
		e.stopPropagation()

		// Determine zoom direction and amount
		// Negative deltaY means scrolling up (zoom in), positive means scrolling down (zoom out)
		const delta = e.deltaY > 0 ? -0.2 : 0.2
		adjustZoom(delta)
	}, [])

	/**
	 * Handle mouse enter event for image container
	 */
	const handleMouseEnter = () => {
		setIsHovering(true)
	}

	/**
	 * Handle mouse leave event for image container
	 */
	const handleMouseLeave = () => {
		setIsHovering(false)
	}

	const handleImageError = useCallback(() => {
		setImageError("Failed to load image")
	}, [])

	const handleImageLoad = useCallback(() => {
		setImageError(null)
	}, [])

	/**
	 * Format the display path for the image
	 */
	const formatDisplayPath = (path: string): string => {
		// If it's already a relative path starting with ./, keep it
		if (path.startsWith("./")) return path
		// If it's an absolute path, extract the relative portion
		// Look for workspace patterns - match the last segment after any directory separator
		const workspaceMatch = path.match(/\/([^/]+)\/(.+)$/)
		if (workspaceMatch && workspaceMatch[2]) {
			// Return relative path from what appears to be the workspace root
			return `./${workspaceMatch[2]}`
		}
		// Otherwise, just get the filename
		const filename = path.split("/").pop()
		return filename || path
	}

	// Handle missing image URI
	if (!imageUri) {
		return (
			<div
				className={`relative w-full ${className}`}
				style={{
					minHeight: "100px",
					backgroundColor: "var(--vscode-editor-background)",
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
				}}>
				<span style={{ color: "var(--vscode-descriptionForeground)" }}>{t("common:image.noData")}</span>
			</div>
		)
	}

	return (
		<>
			<div
				className={`relative w-full ${className}`}
				onMouseEnter={handleMouseEnter}
				onMouseLeave={handleMouseLeave}>
				{imageError ? (
					<div
						style={{
							minHeight: "100px",
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							backgroundColor: "var(--vscode-editor-background)",
							borderRadius: "4px",
							padding: "20px",
						}}>
						<span style={{ color: "var(--vscode-errorForeground)" }}>⚠️ {imageError}</span>
					</div>
				) : (
					<img
						src={imageUri}
						alt={alt}
						className="w-full h-auto rounded cursor-pointer"
						onClick={handleOpenInEditor}
						onError={handleImageError}
						onLoad={handleImageLoad}
						style={{
							maxHeight: "400px",
							objectFit: "contain",
							backgroundColor: "var(--vscode-editor-background)",
						}}
					/>
				)}
				{imagePath && (
					<div className="mt-1 text-xs text-vscode-descriptionForeground">{formatDisplayPath(imagePath)}</div>
				)}
				{showControls && isHovering && (
					<div className="absolute bottom-2 right-2 flex gap-1 bg-vscode-editor-background/90 rounded p-0.5 z-10 opacity-100 transition-opacity duration-200 ease-in-out">
						<MermaidActionButtons
							onZoom={handleZoom}
							onCopy={handleCopy}
							onSave={handleSave}
							onViewCode={() => {}} // Not applicable for images
							copyFeedback={copyFeedback}
						/>
					</div>
				)}
			</div>

			<Modal isOpen={showModal} onClose={() => setShowModal(false)}>
				<div className="flex justify-between items-center border-b border-vscode-editorGroup-border">
					<div className="flex gap-0">
						<TabButton
							icon="file-media"
							label={t("common:image.tabs.view")}
							isActive={true}
							onClick={() => {}}
						/>
					</div>

					<div className="pr-3">
						<StandardTooltip content={t("common:mermaid.buttons.close")}>
							<IconButton icon="close" onClick={() => setShowModal(false)} />
						</StandardTooltip>
					</div>
				</div>
				<div
					className="flex-1 p-4 pb-[60px] overflow-auto flex items-center justify-center"
					onWheel={handleWheel}>
					<div
						style={{
							transform: `scale(${zoomLevel}) translate(${dragPosition.x}px, ${dragPosition.y}px)`,
							transformOrigin: "center center",
							transition: isDragging ? "none" : "transform 0.1s ease",
							cursor: isDragging ? "grabbing" : "grab",
						}}
						onMouseDown={(e) => {
							setIsDragging(true)
							e.preventDefault()
						}}
						onMouseMove={(e) => {
							if (isDragging) {
								setDragPosition((prev) => ({
									x: prev.x + e.movementX / zoomLevel,
									y: prev.y + e.movementY / zoomLevel,
								}))
							}
						}}
						onMouseUp={() => setIsDragging(false)}
						onMouseLeave={() => setIsDragging(false)}>
						<img
							src={imageUri}
							alt={alt}
							style={{
								maxWidth: "90vw",
								maxHeight: "80vh",
								objectFit: "contain",
							}}
						/>
					</div>
					<div className="absolute bottom-4 left-4 bg-vscode-editor-background border border-vscode-editorGroup-border rounded px-2 py-1 text-xs text-vscode-descriptionForeground pointer-events-none opacity-80">
						{Math.round(zoomLevel * 100)}%
					</div>
				</div>
				<div className="absolute bottom-0 right-0 left-0 p-3 flex items-center justify-end gap-2 bg-vscode-editor-background border-t border-vscode-editorGroup-border rounded-b">
					<ZoomControls
						zoomLevel={zoomLevel}
						zoomInTitle={t("common:mermaid.buttons.zoomIn")}
						zoomOutTitle={t("common:mermaid.buttons.zoomOut")}
						useContinuousZoom={true}
						adjustZoom={adjustZoom}
						zoomInStep={0.2}
						zoomOutStep={-0.2}
					/>
					{imagePath && (
						<StandardTooltip content={t("common:mermaid.buttons.copy")}>
							<IconButton icon={copyFeedback ? "check" : "copy"} onClick={handleCopy} />
						</StandardTooltip>
					)}
					<StandardTooltip content={t("common:mermaid.buttons.save")}>
						<IconButton icon="save" onClick={handleSave} />
					</StandardTooltip>
				</div>
			</Modal>
		</>
	)
}
