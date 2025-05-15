import React, { useRef, useState, useEffect, useMemo, useCallback } from "react"
import { useClickAway, useWindowSize } from "react-use"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { CODE_BLOCK_BG_COLOR } from "@/components/common/CodeBlock"
import { vscode } from "@/utils/vscode"
import { VSCodeTextField, VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { getAsVar, VSC_FOREGROUND, VSC_TITLEBAR_INACTIVE_FOREGROUND } from "@/utils/vscStyles"
import { AutoApprovalSettings } from "@shared/AutoApprovalSettings"
import HeroTooltip from "@/components/common/HeroTooltip"
import AutoApproveMenuItem from "./AutoApproveMenuItem"
import { ActionMetadata } from "./types"

const breakpoint = 500

interface AutoApproveModalProps {
	isVisible: boolean
	setIsVisible: (visible: boolean) => void
	buttonRef: React.RefObject<HTMLDivElement>
	ACTION_METADATA: ActionMetadata[]
	NOTIFICATIONS_SETTING: ActionMetadata
}

const AutoApproveModal: React.FC<AutoApproveModalProps> = ({
	isVisible,
	setIsVisible,
	buttonRef,
	ACTION_METADATA,
	NOTIFICATIONS_SETTING,
}) => {
	const { autoApprovalSettings } = useExtensionState()
	const modalRef = useRef<HTMLDivElement>(null)
	const itemsContainerRef = useRef<HTMLDivElement>(null)
	const { width: viewportWidth, height: viewportHeight } = useWindowSize()
	const [arrowPosition, setArrowPosition] = useState(0)
	const [menuPosition, setMenuPosition] = useState(0)
	const [containerWidth, setContainerWidth] = useState(0)

	// Favorites are derived from autoApprovalSettings
	const favorites = useMemo(() => autoApprovalSettings.favorites || [], [autoApprovalSettings.favorites])

	useClickAway(modalRef, (e) => {
		// Skip if click was on the button that toggles the modal
		if (buttonRef.current && buttonRef.current.contains(e.target as Node)) {
			return
		}
		setIsVisible(false)
	})

	// Calculate positions for modal and arrow
	useEffect(() => {
		if (isVisible && buttonRef.current) {
			const buttonRect = buttonRef.current.getBoundingClientRect()
			const buttonCenter = buttonRect.left + buttonRect.width / 2
			const rightPosition = document.documentElement.clientWidth - buttonCenter - 5

			setArrowPosition(rightPosition)
			setMenuPosition(buttonRect.top + 1)
		}
	}, [isVisible, viewportWidth, viewportHeight, buttonRef])

	// Track container width for responsive layout
	useEffect(() => {
		if (!isVisible) return

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

	const toggleFavorite = useCallback(
		(actionId: string) => {
			const currentFavorites = autoApprovalSettings.favorites || []
			let newFavorites: string[]

			if (currentFavorites.includes(actionId)) {
				newFavorites = currentFavorites.filter((id) => id !== actionId)
			} else {
				newFavorites = [...currentFavorites, actionId]
			}

			vscode.postMessage({
				type: "autoApprovalSettings",
				autoApprovalSettings: {
					...autoApprovalSettings,
					version: (autoApprovalSettings.version ?? 1) + 1,
					favorites: newFavorites,
				},
			})
		},
		[autoApprovalSettings],
	)

	const updateAction = useCallback(
		(action: ActionMetadata, value: boolean) => {
			const actionId = action.id
			const subActionId = action.subAction?.id

			if (actionId === "enableAll" || subActionId === "enableAll") {
				toggleAll(action, value)
				return
			}

			if (actionId === "enableNotifications" || subActionId === "enableNotifications") {
				updateNotifications(action, value)
				return
			}

			let newActions = {
				...autoApprovalSettings.actions,
				[actionId]: value,
			}

			if (value === false && subActionId) {
				newActions[subActionId] = false
			}

			if (value === true && action.parentActionId) {
				newActions[action.parentActionId as keyof AutoApprovalSettings["actions"]] = true
			}

			// Check if this will result in any enabled actions
			const willHaveEnabledActions = Object.values(newActions).some(Boolean)

			vscode.postMessage({
				type: "autoApprovalSettings",
				autoApprovalSettings: {
					...autoApprovalSettings,
					version: (autoApprovalSettings.version ?? 1) + 1,
					actions: newActions,
					enabled: willHaveEnabledActions,
				},
			})
		},
		[autoApprovalSettings],
	)

	const updateMaxRequests = useCallback(
		(maxRequests: number) => {
			const currentSettings = autoApprovalSettings
			vscode.postMessage({
				type: "autoApprovalSettings",
				autoApprovalSettings: {
					...currentSettings,
					version: (currentSettings.version ?? 1) + 1,
					maxRequests,
				},
			})
		},
		[autoApprovalSettings],
	)

	const updateNotifications = useCallback(
		(action: ActionMetadata, checked: boolean) => {
			if (action.id === "enableNotifications") {
				const currentSettings = autoApprovalSettings
				vscode.postMessage({
					type: "autoApprovalSettings",
					autoApprovalSettings: {
						...currentSettings,
						version: (currentSettings.version ?? 1) + 1,
						enableNotifications: checked,
					},
				})
			}
		},
		[autoApprovalSettings],
	)

	const toggleAll = useCallback(
		(action: ActionMetadata, checked: boolean) => {
			let actions = { ...autoApprovalSettings.actions }

			for (const action of Object.keys(actions)) {
				actions[action as keyof AutoApprovalSettings["actions"]] = checked
			}

			vscode.postMessage({
				type: "autoApprovalSettings",
				autoApprovalSettings: {
					...autoApprovalSettings,
					version: (autoApprovalSettings.version ?? 1) + 1,
					actions,
				},
			})
		},
		[autoApprovalSettings],
	)

	// Check if action is enabled
	const isChecked = (action: ActionMetadata): boolean => {
		if (action.id === "enableNotifications") {
			return autoApprovalSettings.enableNotifications
		}
		if (action.id === "enableAll") {
			return Object.values(autoApprovalSettings.actions).every(Boolean)
		}
		return autoApprovalSettings.actions[action.id] ?? false
	}

	// Check if action is favorited
	const isFavorited = (action: ActionMetadata): boolean => {
		return favorites.includes(action.id)
	}

	if (!isVisible) return null

	return (
		<div ref={modalRef}>
			<div
				className="fixed left-[15px] right-[15px] border border-[var(--vscode-editorGroup-border)] p-3 rounded z-[1000] overflow-y-auto"
				style={{
					bottom: `calc(100vh - ${menuPosition}px + 6px)`,
					background: CODE_BLOCK_BG_COLOR,
					maxHeight: "calc(100vh - 100px)",
					overscrollBehavior: "contain",
				}}>
				<div
					className="fixed w-[10px] h-[10px] z-[-1] rotate-45 border-r border-b border-[var(--vscode-editorGroup-border)]"
					style={{
						bottom: `calc(100vh - ${menuPosition}px)`,
						right: arrowPosition,
						background: CODE_BLOCK_BG_COLOR,
					}}
				/>

				<div className="flex justify-between items-center mb-3">
					<div className="m-0 text-base font-semibold">Auto-approve Settings</div>
					<VSCodeButton appearance="icon" onClick={() => setIsVisible(false)}>
						<span className="codicon codicon-close text-[10px]"></span>
					</VSCodeButton>
				</div>

				<HeroTooltip
					content="Auto-approve allows Cline to perform the following actions without asking for permission. Please use with caution and only enable if you understand the risks."
					placement="top">
					<div className="mb-3">
						<span className="text-[color:var(--vscode-foreground)] font-medium">Actions:</span>
					</div>
				</HeroTooltip>

				<div
					ref={itemsContainerRef}
					className="relative mb-6"
					style={{
						columnCount: containerWidth > breakpoint ? 2 : 1,
						columnGap: "4px",
					}}>
					{/* Vertical separator line - only visible in two-column mode */}
					{containerWidth > breakpoint && (
						<div
							className="absolute left-1/2 top-0 bottom-0 w-[0.5px] opacity-20"
							style={{
								background: getAsVar(VSC_TITLEBAR_INACTIVE_FOREGROUND),
								transform: "translateX(-50%)", // Center the line
							}}
						/>
					)}

					{/* All items in a single list - CSS Grid will handle the column distribution */}
					{ACTION_METADATA.map((action) => (
						<AutoApproveMenuItem
							key={action.id}
							action={action}
							isChecked={isChecked}
							isFavorited={isFavorited}
							onToggle={updateAction}
							onToggleFavorite={toggleFavorite}
						/>
					))}
				</div>

				<div className="mb-3">
					<span className="text-[color:var(--vscode-foreground)] font-medium">Quick Settings:</span>
				</div>

				<AutoApproveMenuItem
					key={NOTIFICATIONS_SETTING.id}
					action={NOTIFICATIONS_SETTING}
					isChecked={isChecked}
					isFavorited={isFavorited}
					onToggle={updateAction}
					onToggleFavorite={toggleFavorite}
				/>

				<HeroTooltip
					content="Cline will automatically make this many API requests before asking for approval to proceed with the task."
					placement="top">
					<div className="flex items-center pl-1.5 my-2">
						<span className="codicon codicon-settings text-[#CCCCCC] text-[14px]" />
						<span className="text-[#CCCCCC] text-xs font-medium ml-2">Max Requests:</span>
						<VSCodeTextField
							className="flex-1 w-full pr-[35px] ml-4"
							value={autoApprovalSettings.maxRequests.toString()}
							onInput={(e) => {
								const input = e.target as HTMLInputElement
								// Remove any non-numeric characters
								input.value = input.value.replace(/[^0-9]/g, "")
								const value = parseInt(input.value)
								if (!isNaN(value) && value > 0) {
									updateMaxRequests(value)
								}
							}}
							onKeyDown={(e) => {
								// Prevent non-numeric keys (except for backspace, delete, arrows)
								if (!/^\d$/.test(e.key) && !["Backspace", "Delete", "ArrowLeft", "ArrowRight"].includes(e.key)) {
									e.preventDefault()
								}
							}}
						/>
					</div>
				</HeroTooltip>
			</div>
		</div>
	)
}

export default AutoApproveModal
