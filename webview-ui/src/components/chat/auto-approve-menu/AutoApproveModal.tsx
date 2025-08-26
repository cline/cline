import { VSCodeButton, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import React, { useEffect, useRef, useState } from "react"
import { useClickAway, useWindowSize } from "react-use"
import { CODE_BLOCK_BG_COLOR } from "@/components/common/CodeBlock"
import HeroTooltip from "@/components/common/HeroTooltip"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useAutoApproveActions } from "@/hooks/useAutoApproveActions"
import { getAsVar, VSC_TITLEBAR_INACTIVE_FOREGROUND } from "@/utils/vscStyles"
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
	const { isChecked, isFavorited, toggleFavorite, updateAction, updateMaxRequests } = useAutoApproveActions()

	const modalRef = useRef<HTMLDivElement>(null)
	const itemsContainerRef = useRef<HTMLDivElement>(null)
	const { width: viewportWidth, height: viewportHeight } = useWindowSize()
	const [arrowPosition, setArrowPosition] = useState(0)
	const [menuPosition, setMenuPosition] = useState(0)
	const [containerWidth, setContainerWidth] = useState(0)

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

	// Calculate safe positioning to prevent overflow while preserving original position
	const calculateModalStyle = () => {
		// Original positioning: bottom: calc(100vh - ${menuPosition}px + 6px)
		const originalBottom = viewportHeight - menuPosition + 6

		// Calculate the available space from the button to the top of the viewport
		const availableSpace = viewportHeight - originalBottom

		// Set a minimum top margin to prevent the modal from touching the top edge
		const minTopMargin = 15

		// Calculate the maximum height the modal can have
		// Use the full available space minus the top margin, but also respect the original constraint
		const maxAvailableHeight = availableSpace - minTopMargin
		const originalMaxHeight = viewportHeight - 100

		// Use the smaller of the two to ensure we don't overflow but still use full height when possible
		let finalMaxHeight: number

		if (menuPosition <= minTopMargin) {
			// Button is very close to the top, use all available space
			finalMaxHeight = maxAvailableHeight
		} else {
			// Normal case: use the original max height unless it would cause overflow
			finalMaxHeight = Math.min(originalMaxHeight, maxAvailableHeight)
		}

		return {
			bottom: `${originalBottom}px`,
			maxHeight: `${Math.max(finalMaxHeight, 200)}px`, // Ensure minimum usable height
			background: CODE_BLOCK_BG_COLOR,
			overscrollBehavior: "contain" as const,
		}
	}

	return (
		<div className="overflow-hidden" ref={modalRef}>
			<div
				className="fixed left-[15px] right-[15px] border border-[var(--vscode-editorGroup-border)] rounded z-[1000] flex flex-col"
				style={calculateModalStyle()}>
				<div
					className="fixed w-[10px] h-[10px] z-[-1] rotate-45 border-r border-b border-[var(--vscode-editorGroup-border)]"
					style={{
						bottom: `calc(100vh - ${menuPosition}px)`,
						right: arrowPosition,
						background: CODE_BLOCK_BG_COLOR,
					}}
				/>
				{/* Scrollable content container */}
				<div className="overflow-y-auto p-3 flex-1 min-h-0 overscroll-contain">
					<div className="flex justify-between items-center mb-3">
						<HeroTooltip
							content="Auto-approve allows Cline to perform the following actions without asking for permission. Please use with caution and only enable if you understand the risks."
							placement="top">
							<div className="text-base font-semibold mb-1">Auto-approve Settings</div>
						</HeroTooltip>
						<VSCodeButton appearance="icon" onClick={() => setIsVisible(false)}>
							<span className="codicon codicon-close text-[10px]"></span>
						</VSCodeButton>
					</div>

					<div className="mb-2.5">
						<span className="text-[color:var(--vscode-foreground)] font-medium">Actions:</span>
					</div>

					<div
						className="relative mb-6"
						ref={itemsContainerRef}
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
								action={action}
								isChecked={isChecked}
								isFavorited={isFavorited}
								key={action.id}
								onToggle={updateAction}
								onToggleFavorite={toggleFavorite}
							/>
						))}
					</div>

					<div className="mb-2.5">
						<span className="text-[color:var(--vscode-foreground)] font-medium">Quick Settings:</span>
					</div>

					<AutoApproveMenuItem
						action={NOTIFICATIONS_SETTING}
						isChecked={isChecked}
						isFavorited={isFavorited}
						key={NOTIFICATIONS_SETTING.id}
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
								onInput={async (e) => {
									const input = e.target as HTMLInputElement
									// Remove any non-numeric characters
									input.value = input.value.replace(/[^0-9]/g, "")
									const value = parseInt(input.value)
									if (!Number.isNaN(value) && value > 0) {
										await updateMaxRequests(value)
									}
								}}
								onKeyDown={(e) => {
									// Prevent non-numeric keys (except for backspace, delete, arrows)
									if (
										!/^\d$/.test(e.key) &&
										!["Backspace", "Delete", "ArrowLeft", "ArrowRight"].includes(e.key)
									) {
										e.preventDefault()
									}
								}}
								value={autoApprovalSettings.maxRequests.toString()}
							/>
						</div>
					</HeroTooltip>
				</div>
			</div>
		</div>
	)
}

export default AutoApproveModal
