import React from "react"
import { ChevronUp, Check } from "lucide-react"
import { cn } from "@/lib/utils"
import { useRooPortal } from "@/components/ui/hooks/useRooPortal"
import { Popover, PopoverContent, PopoverTrigger, StandardTooltip } from "@/components/ui"
import { IconButton } from "./IconButton"
import { vscode } from "@/utils/vscode"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { Mode, getAllModes } from "@roo/modes"
import { ModeConfig, CustomModePrompts } from "@roo-code/types"
import { telemetryClient } from "@/utils/TelemetryClient"
import { TelemetryEventName } from "@roo-code/types"

interface ModeSelectorProps {
	value: Mode
	onChange: (value: Mode) => void
	disabled?: boolean
	title?: string
	triggerClassName?: string
	modeShortcutText: string
	customModes?: ModeConfig[]
	customModePrompts?: CustomModePrompts
}

export const ModeSelector = ({
	value,
	onChange,
	disabled = false,
	title = "",
	triggerClassName = "",
	modeShortcutText,
	customModes,
	customModePrompts,
}: ModeSelectorProps) => {
	const [open, setOpen] = React.useState(false)
	const portalContainer = useRooPortal("roo-portal")
	const { hasOpenedModeSelector, setHasOpenedModeSelector } = useExtensionState()
	const { t } = useAppTranslation()

	const trackModeSelectorOpened = () => {
		// Track telemetry every time the mode selector is opened
		telemetryClient.capture(TelemetryEventName.MODE_SELECTOR_OPENED)

		// Track first-time usage for UI purposes
		if (!hasOpenedModeSelector) {
			setHasOpenedModeSelector(true)
			vscode.postMessage({ type: "hasOpenedModeSelector", bool: true })
		}
	}

	// Get all modes including custom modes and merge custom prompt descriptions
	const modes = React.useMemo(() => {
		const allModes = getAllModes(customModes)
		return allModes.map((mode) => ({
			...mode,
			description: customModePrompts?.[mode.slug]?.description ?? mode.description,
		}))
	}, [customModes, customModePrompts])

	// Find the selected mode
	const selectedMode = React.useMemo(() => modes.find((mode) => mode.slug === value), [modes, value])

	const trigger = (
		<PopoverTrigger
			disabled={disabled}
			data-testid="mode-selector-trigger"
			className={cn(
				"inline-flex items-center gap-1.5 relative whitespace-nowrap px-1.5 py-1 text-xs",
				"bg-transparent border border-[rgba(255,255,255,0.08)] rounded-md text-vscode-foreground",
				"transition-all duration-150 focus:outline-none focus-visible:ring-1 focus-visible:ring-vscode-focusBorder focus-visible:ring-inset",
				disabled
					? "opacity-50 cursor-not-allowed"
					: "opacity-90 hover:opacity-100 hover:bg-[rgba(255,255,255,0.03)] hover:border-[rgba(255,255,255,0.15)] cursor-pointer",
				triggerClassName,
				!disabled && !hasOpenedModeSelector
					? "bg-primary opacity-90 hover:bg-primary-hover text-vscode-button-foreground"
					: null,
			)}>
			<ChevronUp className="pointer-events-none opacity-80 flex-shrink-0 size-3" />
			<span className="truncate">{selectedMode?.name || ""}</span>
		</PopoverTrigger>
	)

	return (
		<Popover
			open={open}
			onOpenChange={(isOpen) => {
				if (isOpen) trackModeSelectorOpened()
				setOpen(isOpen)
			}}
			data-testid="mode-selector-root">
			{title ? <StandardTooltip content={title}>{trigger}</StandardTooltip> : trigger}

			<PopoverContent
				align="start"
				sideOffset={4}
				container={portalContainer}
				className="p-0 overflow-hidden min-w-80 max-w-9/10">
				<div className="flex flex-col w-full">
					<div className="p-3 border-b border-vscode-dropdown-border cursor-default">
						<div className="flex flex-row items-center gap-1 p-0 mt-0 mb-1 w-full">
							<h4 className="m-0 pb-2 flex-1">{t("chat:modeSelector.title")}</h4>
							<div className="flex flex-row gap-1 ml-auto mb-1">
								<IconButton
									iconClass="codicon-extensions"
									title={t("chat:modeSelector.marketplace")}
									onClick={() => {
										window.postMessage(
											{
												type: "action",
												action: "marketplaceButtonClicked",
												values: { marketplaceTab: "mode" },
											},
											"*",
										)

										setOpen(false)
									}}
								/>
								<IconButton
									iconClass="codicon-settings-gear"
									title={t("chat:modeSelector.settings")}
									onClick={() => {
										vscode.postMessage({
											type: "switchTab",
											tab: "modes",
										})
										setOpen(false)
									}}
								/>
							</div>
						</div>
						<p className="my-0 pr-4 text-sm w-full">
							{t("chat:modeSelector.description")}
							<br />
							{modeShortcutText}
						</p>
					</div>

					{/* Mode List */}
					<div className="max-h-[400px] overflow-y-auto py-0">
						{modes.map((mode) => (
							<div
								className={cn(
									"p-2 text-sm cursor-pointer flex flex-row gap-4 items-center",
									"hover:bg-vscode-list-hoverBackground",
									mode.slug === value
										? "bg-vscode-list-activeSelectionBackground text-vscode-list-activeSelectionForeground"
										: "",
								)}
								key={mode.slug}
								onClick={() => {
									onChange(mode.slug as Mode)
									setOpen(false)
								}}
								data-testid="mode-selector-item">
								<div className="flex-grow">
									<p className="m-0 mb-0 font-bold">{mode.name}</p>
									{mode.description && (
										<p className="m-0 py-0 pl-4 h-4 flex-1 text-xs overflow-hidden">
											{mode.description}
										</p>
									)}
								</div>
								{mode.slug === value ? (
									<Check className="m-0 size-4 p-0.5" />
								) : (
									<div className="size-4" />
								)}
							</div>
						))}
					</div>
				</div>
			</PopoverContent>
		</Popover>
	)
}

export default ModeSelector
