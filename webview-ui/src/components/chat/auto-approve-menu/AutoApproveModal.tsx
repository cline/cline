import { StringRequest } from "@shared/proto/cline/common"
import React, { useEffect, useRef, useState } from "react"
import { useClickAway } from "react-use"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useAutoApproveActions } from "@/hooks/useAutoApproveActions"
import { UiServiceClient } from "@/services/grpc-client"
import { getAsVar, VSC_TITLEBAR_INACTIVE_FOREGROUND } from "@/utils/vscStyles"
import AutoApproveMenuItem from "./AutoApproveMenuItem"
import { updateAutoApproveSettings } from "./AutoApproveSettingsAPI"
import { ActionMetadata } from "./types"

const breakpoint = 500

interface AutoApproveModalProps {
	isVisible: boolean
	setIsVisible: (visible: boolean) => void
	buttonRef: React.RefObject<HTMLDivElement>
	ACTION_METADATA: ActionMetadata[]
	YOLO_MODE_SETTING: ActionMetadata
}

const AutoApproveModal: React.FC<AutoApproveModalProps> = ({
	isVisible,
	setIsVisible,
	buttonRef,
	ACTION_METADATA,
	YOLO_MODE_SETTING,
}) => {
	const { yoloModeToggled, remoteConfigSettings, navigateToSettings, autoApprovalSettings } = useExtensionState()
	const { isChecked, updateAction } = useAutoApproveActions()

	// Check if YOLO mode is locked by organization
	const isYoloModeLocked = remoteConfigSettings?.yoloModeToggled !== undefined

	const handleNotificationsLinkClick = async (e: React.MouseEvent) => {
		e.preventDefault()
		e.stopPropagation()

		// Navigate to settings
		navigateToSettings()

		// Scroll to general section
		setTimeout(async () => {
			try {
				await UiServiceClient.scrollToSettings(StringRequest.create({ value: "general" }))
			} catch (error) {
				console.error("Error scrolling to general settings:", error)
			}
		}, 300)
	}

	const modalRef = useRef<HTMLDivElement>(null)
	const itemsContainerRef = useRef<HTMLDivElement>(null)
	const [containerWidth, setContainerWidth] = useState(0)

	useClickAway(modalRef, (e) => {
		// Skip if click was on the button that toggles the modal
		if (buttonRef.current && buttonRef.current.contains(e.target as Node)) {
			return
		}
		setIsVisible(false)
	})

	// Track container width for responsive layout
	useEffect(() => {
		if (!isVisible) {
			return
		}

		const updateWidth = () => {
			if (itemsContainerRef.current) {
				setContainerWidth(itemsContainerRef.current.offsetWidth)
			}
		}

		// Initial measurement
		updateWidth()

		// Set up resize observer
		const resizeObserver = new ResizeObserver(updateWidth)
		if (itemsContainerRef.current) {
			resizeObserver.observe(itemsContainerRef.current)
		}

		// Clean up
		return () => {
			resizeObserver.disconnect()
		}
	}, [isVisible])

	if (!isVisible) {
		return null
	}

	return (
		<div ref={modalRef}>
			{/* Expanded menu content - renders directly below the bar */}
			<div
				className="overflow-y-auto pb-3 px-3.5 overscroll-contain"
				style={{
					maxHeight: "60vh",
				}}>
				<div className="mb-2.5 text-muted-foreground text-xs cursor-pointer" onClick={() => setIsVisible(false)}>
					Let Cline take these actions without asking for approval.{" "}
					<span
						className="underline cursor-pointer hover:text-foreground"
						onClick={handleNotificationsLinkClick}
						style={{ textDecoration: "underline" }}>
						Configure notification settings
					</span>
				</div>

				{/* Wrapper with conditional opacity/pointer-events for when YOLO mode is enabled */}
				<div style={{ opacity: yoloModeToggled ? 0.5 : 1, pointerEvents: yoloModeToggled ? "none" : "auto" }}>
					<div
						className="relative mb-2 w-full"
						ref={itemsContainerRef}
						style={{
							columnCount: containerWidth > breakpoint ? 2 : 1,
							columnGap: "4px",
						}}>
						{/* Vertical separator line - only visible in two-column mode */}
						{containerWidth > breakpoint && (
							<div
								className="absolute left-1/2 top-0 bottom-0 opacity-20"
								style={{
									background: getAsVar(VSC_TITLEBAR_INACTIVE_FOREGROUND),
									transform: "translateX(-50%)", // Center the line
								}}
							/>
						)}

						{/* All items in a single list - CSS Grid will handle the column distribution */}
						{ACTION_METADATA.map((action) => (
							<AutoApproveMenuItem action={action} isChecked={isChecked} key={action.id} onToggle={updateAction} />
						))}
					</div>
				</div>

				{/* Horizontal separator with OR label */}
				<div className="flex items-center gap-2 mb-1">
					<div
						className="flex-1 h-px"
						style={{
							backgroundColor: `color-mix(in srgb, ${getAsVar(VSC_TITLEBAR_INACTIVE_FOREGROUND)} 20%, transparent)`,
						}}
					/>
					<span className="text-muted-foreground text-xs">OR</span>
					<div
						className="flex-1 h-px"
						style={{
							backgroundColor: `color-mix(in srgb, ${getAsVar(VSC_TITLEBAR_INACTIVE_FOREGROUND)} 20%, transparent)`,
						}}
					/>
				</div>

				{/* YOLO Mode Toggle */}
				<Tooltip>
					<TooltipTrigger asChild>
						<div className="flex items-center gap-2">
							<AutoApproveMenuItem
								action={YOLO_MODE_SETTING}
								disabled={isYoloModeLocked}
								isChecked={isChecked}
								key={YOLO_MODE_SETTING.id}
								onToggle={updateAction}
							/>
							{isYoloModeLocked && <i className="codicon codicon-lock text-description text-sm" />}
						</div>
					</TooltipTrigger>
					<TooltipContent className="max-w-xs" hidden={!isYoloModeLocked} side="top">
						This setting is managed by your organization's remote configuration
					</TooltipContent>
				</Tooltip>

				<div className="mt-0 ml-8 text-muted-foreground text-xs">
					Does not plan or ask questions. If you want to use Plan mode,{" "}
					<span
						className="underline cursor-pointer hover:text-foreground"
						onClick={async () => {
							// Disable YOLO mode if it's on
							if (yoloModeToggled) {
								await updateAction(YOLO_MODE_SETTING, false)
							}
							// Enable all auto-approve options
							const allActions = ACTION_METADATA.reduce((acc, action) => {
								acc[action.id as keyof typeof acc] = true
								if (action.subAction) {
									acc[action.subAction.id as keyof typeof acc] = true
								}
								return acc
							}, {} as any)

							await updateAutoApproveSettings({
								...autoApprovalSettings,
								version: (autoApprovalSettings.version ?? 1) + 1,
								actions: allActions,
							})
						}}>
						enable all auto-approve options
					</span>{" "}
					instead.
				</div>
			</div>
		</div>
	)
}

export default AutoApproveModal
