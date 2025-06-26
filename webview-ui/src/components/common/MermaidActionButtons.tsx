import React from "react"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { IconButton } from "./IconButton"
import { ZoomControls } from "./ZoomControls"
import { StandardTooltip } from "@/components/ui"

interface MermaidActionButtonsProps {
	onZoom?: (e: React.MouseEvent) => void
	onZoomIn?: () => void
	onZoomOut?: () => void
	onCopy: (e: React.MouseEvent) => void
	onSave?: (e: React.MouseEvent) => void
	onViewCode: () => void
	onClose?: () => void
	copyFeedback: boolean
	showZoomControls?: boolean
	zoomLevel?: number
}

export const MermaidActionButtons: React.FC<MermaidActionButtonsProps> = ({
	onZoom,
	onZoomIn,
	onZoomOut,
	onCopy,
	onSave,
	onViewCode,
	onClose,
	copyFeedback,
	showZoomControls = false,
	zoomLevel,
}) => {
	const { t } = useAppTranslation()

	if (showZoomControls && onZoomOut && onZoomIn && zoomLevel !== undefined) {
		return (
			<>
				<ZoomControls
					zoomLevel={zoomLevel}
					onZoomIn={onZoomIn}
					onZoomOut={onZoomOut}
					zoomInTitle={t("common:mermaid.buttons.zoomIn")}
					zoomOutTitle={t("common:mermaid.buttons.zoomOut")}
				/>
				<StandardTooltip content={t("common:mermaid.buttons.viewCode")}>
					<IconButton
						icon="code"
						onClick={(e: React.MouseEvent) => {
							e.stopPropagation()
							onViewCode()
						}}
					/>
				</StandardTooltip>
				<StandardTooltip content={t("common:mermaid.buttons.copy")}>
					<IconButton icon={copyFeedback ? "check" : "copy"} onClick={onCopy} />
				</StandardTooltip>
			</>
		)
	}

	return (
		<>
			{onZoom && (
				<StandardTooltip content={t("common:mermaid.buttons.zoom")}>
					<IconButton icon="zoom-in" onClick={onZoom} />
				</StandardTooltip>
			)}
			<StandardTooltip content={t("common:mermaid.buttons.viewCode")}>
				<IconButton
					icon="code"
					onClick={(e: React.MouseEvent) => {
						e.stopPropagation()
						onViewCode()
					}}
				/>
			</StandardTooltip>
			<StandardTooltip content={t("common:mermaid.buttons.copy")}>
				<IconButton icon={copyFeedback ? "check" : "copy"} onClick={onCopy} />
			</StandardTooltip>
			{onSave && (
				<StandardTooltip content={t("common:mermaid.buttons.save")}>
					<IconButton icon="save" onClick={onSave} />
				</StandardTooltip>
			)}
			{onClose && (
				<StandardTooltip content={t("common:mermaid.buttons.close")}>
					<IconButton icon="close" onClick={onClose} />
				</StandardTooltip>
			)}
		</>
	)
}
