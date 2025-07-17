import React from "react"
import { Mode } from "@roo/modes"
import { Button, StandardTooltip } from "@/components/ui"
import { Image, SendHorizontal } from "lucide-react"
import { cn } from "@/lib/utils"
import ModeSelector from "./ModeSelector"
import { useAppTranslation } from "@/i18n/TranslationContext"

interface EditModeControlsProps {
	mode: Mode
	onModeChange: (value: Mode) => void
	modeShortcutText: string
	customModes: any
	customModePrompts: any
	onCancel?: () => void
	onSend: () => void
	onSelectImages: () => void
	sendingDisabled: boolean
	shouldDisableImages: boolean
}

export const EditModeControls: React.FC<EditModeControlsProps> = ({
	mode,
	onModeChange,
	modeShortcutText,
	customModes,
	customModePrompts,
	onCancel,
	onSend,
	onSelectImages,
	sendingDisabled,
	shouldDisableImages,
}) => {
	const { t } = useAppTranslation()

	return (
		<div
			className={cn(
				"flex",
				"items-center",
				"justify-between",
				"absolute",
				"bottom-2",
				"left-2",
				"right-2",
				"z-30",
			)}>
			<div className={cn("flex", "items-center", "gap-1", "flex-1", "min-w-0")}>
				<div className="shrink-0">
					<ModeSelector
						value={mode}
						title={t("chat:selectMode")}
						onChange={onModeChange}
						triggerClassName="w-full"
						modeShortcutText={modeShortcutText}
						customModes={customModes}
						customModePrompts={customModePrompts}
					/>
				</div>
			</div>
			<div className={cn("flex", "items-center", "gap-0.5", "shrink-0", "ml-2")}>
				<Button
					variant="secondary"
					size="sm"
					onClick={onCancel}
					disabled={sendingDisabled}
					className="text-xs bg-vscode-toolbar-hoverBackground hover:bg-vscode-button-secondaryBackground text-vscode-button-secondaryForeground">
					Cancel
				</Button>
				<StandardTooltip content={t("chat:addImages")}>
					<button
						aria-label={t("chat:addImages")}
						disabled={shouldDisableImages}
						onClick={!shouldDisableImages ? onSelectImages : undefined}
						className={cn(
							"relative inline-flex items-center justify-center",
							"bg-transparent border-none p-1.5",
							"rounded-md min-w-[28px] min-h-[28px]",
							"opacity-60 hover:opacity-100 text-vscode-descriptionForeground hover:text-vscode-foreground",
							"transition-all duration-150",
							"hover:bg-[rgba(255,255,255,0.03)] hover:border-[rgba(255,255,255,0.15)]",
							"focus:outline-none focus-visible:ring-1 focus-visible:ring-vscode-focusBorder",
							"active:bg-[rgba(255,255,255,0.1)]",
							!shouldDisableImages && "cursor-pointer",
							shouldDisableImages &&
								"opacity-40 cursor-not-allowed grayscale-[30%] hover:bg-transparent hover:border-[rgba(255,255,255,0.08)] active:bg-transparent",
						)}>
						<Image className="w-4 h-4" />
					</button>
				</StandardTooltip>
				<StandardTooltip content={t("chat:save.tooltip")}>
					<button
						aria-label={t("chat:save.tooltip")}
						disabled={sendingDisabled}
						onClick={!sendingDisabled ? onSend : undefined}
						className={cn(
							"relative inline-flex items-center justify-center",
							"bg-transparent border-none p-1.5",
							"rounded-md min-w-[28px] min-h-[28px]",
							"opacity-60 hover:opacity-100 text-vscode-descriptionForeground hover:text-vscode-foreground",
							"transition-all duration-150",
							"hover:bg-[rgba(255,255,255,0.03)] hover:border-[rgba(255,255,255,0.15)]",
							"focus:outline-none focus-visible:ring-1 focus-visible:ring-vscode-focusBorder",
							"active:bg-[rgba(255,255,255,0.1)]",
							!sendingDisabled && "cursor-pointer",
							sendingDisabled &&
								"opacity-40 cursor-not-allowed grayscale-[30%] hover:bg-transparent hover:border-[rgba(255,255,255,0.08)] active:bg-transparent",
						)}>
						<SendHorizontal className="w-4 h-4" />
					</button>
				</StandardTooltip>
			</div>
		</div>
	)
}
