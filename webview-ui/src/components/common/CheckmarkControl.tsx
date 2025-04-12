import { useCallback, useRef, useState, useEffect, useMemo } from "react"
import { useEvent } from "react-use"
import styled from "styled-components"
import { ExtensionMessage } from "@shared/ExtensionMessage"
import { vscode } from "@/utils/vscode"
import { CODE_BLOCK_BG_COLOR } from "@/components/common/CodeBlock"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { createPortal } from "react-dom"
import { useFloating, offset, flip, shift } from "@floating-ui/react"

interface CheckmarkControlProps {
	messageTs?: number
	isCheckpointCheckedOut?: boolean
	/** Whether this is the last row in the chat */
	isLastRow?: boolean
}

export const CheckmarkControl = ({ messageTs, isCheckpointCheckedOut, isLastRow = false }: CheckmarkControlProps) => {
	const [compareDisabled, setCompareDisabled] = useState(false)
	const [restoreTaskDisabled, setRestoreTaskDisabled] = useState(false)
	const [restoreWorkspaceDisabled, setRestoreWorkspaceDisabled] = useState(false)
	const [restoreBothDisabled, setRestoreBothDisabled] = useState(false)
	const [showRestoreConfirm, setShowRestoreConfirm] = useState(false)
	const [hasMouseEntered, setHasMouseEntered] = useState(false)
	const tooltipRef = useRef<HTMLDivElement>(null)
	const [isComponentHovered, setIsComponentHovered] = useState(false)
	const [isLineHovered, setIsLineHovered] = useState(false)
	const hideTimerRef = useRef<NodeJS.Timeout | null>(null)

	// Cleanup timer on unmount
	useEffect(() => {
		return () => {
			if (hideTimerRef.current) {
				clearTimeout(hideTimerRef.current)
			}
		}
	}, [])

	const { refs, floatingStyles, update, placement } = useFloating({
		placement: "bottom-end",
		middleware: [
			offset({
				mainAxis: 8,
				crossAxis: 10,
			}),
			flip(),
			shift(),
		],
	})

	// Simple time formatter if date-fns is not available
	const getSimpleRelativeTime = (date: Date) => {
		const now = new Date()
		const diffMs = now.getTime() - date.getTime()

		const seconds = Math.floor(diffMs / 1000)
		// Handle "just now" case in the fallback too
		if (seconds < 180) return "now" // 3 minutes = 180 seconds

		const minutes = Math.floor(seconds / 60)
		if (minutes < 60) return `${minutes}m`

		const hours = Math.floor(minutes / 60)
		if (hours < 24) return `${hours}h`

		const days = Math.floor(hours / 24)
		return `${days}d`
	}

	// Format the timestamp for relative time display
	const relativeTime = useMemo(() => {
		if (!messageTs) return ""

		// Create a Date object from the timestamp
		const date = new Date(messageTs)
		const now = new Date()

		// Calculate time difference in milliseconds
		const diffMs = now.getTime() - date.getTime()
		const diffMinutes = Math.floor(diffMs / (1000 * 60))

		// Show "just now" if less than 3 minutes
		if (diffMinutes < 3) {
			return "now"
		}

		// Fallback formatting if date-fns errors
		return getSimpleRelativeTime(date)
	}, [messageTs])

	// Format the full timestamp for the detailed display (without year)
	const formattedTime = useMemo(() => {
		if (!messageTs) return ""
		const date = new Date(messageTs)
		return date.toLocaleString("en-US", {
			month: "short",
			day: "numeric",
			hour: "numeric",
			minute: "2-digit",
			hour12: true,
		})
	}, [messageTs])

	// Combined time format with relative time and full date
	const combinedTimeFormat = useMemo(() => {
		if (!relativeTime || !formattedTime) return ""
		return `${relativeTime} · ${formattedTime}`
	}, [relativeTime, formattedTime])

	useEffect(() => {
		const handleScroll = () => {
			update()
		}
		window.addEventListener("scroll", handleScroll, true)
		return () => window.removeEventListener("scroll", handleScroll, true)
	}, [update])

	useEffect(() => {
		if (showRestoreConfirm) {
			update()
		}
	}, [showRestoreConfirm, update])

	const handleMessage = useCallback((event: MessageEvent<ExtensionMessage>) => {
		if (event.data.type === "relinquishControl") {
			setCompareDisabled(false)
			setRestoreTaskDisabled(false)
			setRestoreWorkspaceDisabled(false)
			setRestoreBothDisabled(false)
			setShowRestoreConfirm(false)
		}
	}, [])

	const handleRestoreTask = () => {
		setRestoreTaskDisabled(true)
		vscode.postMessage({
			type: "checkpointRestore",
			number: messageTs,
			text: "task",
		})
	}

	const handleRestoreWorkspace = () => {
		setRestoreWorkspaceDisabled(true)
		vscode.postMessage({
			type: "checkpointRestore",
			number: messageTs,
			text: "workspace",
		})
	}

	const handleRestoreBoth = () => {
		setRestoreBothDisabled(true)
		vscode.postMessage({
			type: "checkpointRestore",
			number: messageTs,
			text: "taskAndWorkspace",
		})
	}

	const handleMouseEnter = () => {
		setHasMouseEntered(true)
	}

	const handleMouseLeave = () => {
		if (hasMouseEntered) {
			setShowRestoreConfirm(false)
			setHasMouseEntered(false)
		}
	}

	const handleDebounceMouseLeave = (additionalCheck?: () => void) => {
		if (hideTimerRef.current) {
			clearTimeout(hideTimerRef.current)
		}
		hideTimerRef.current = setTimeout(() => {
			setIsLineHovered(false)
			setIsComponentHovered(false)
		}, checkpointHoverDebounce)
		additionalCheck?.()
	}

	const handleIndicatorMouseLeave = (e: React.MouseEvent) => {
		if (e.currentTarget.contains(e.relatedTarget as Node)) {
			return
		}
		handleDebounceMouseLeave()
	}

	const handleControlsMouseLeave = (e: React.MouseEvent) => {
		const tooltipElement = tooltipRef.current

		if (tooltipElement && showRestoreConfirm) {
			const tooltipRect = tooltipElement.getBoundingClientRect()

			if (
				e.clientY >= tooltipRect.top &&
				e.clientY <= tooltipRect.bottom &&
				e.clientX >= tooltipRect.left &&
				e.clientX <= tooltipRect.right
			) {
				return
			}
		}

		setShowRestoreConfirm(false)
		setHasMouseEntered(false)
	}

	useEvent("message", handleMessage)

	// Modified: Only show the expanded UI on hover (not permanently for checked out checkpoints)
	// This way checked out checkpoints only show the line indicator unless hovered
	const showExpandedUI =
		(isLineHovered || isComponentHovered || showRestoreConfirm) &&
		!(showRestoreConfirm === false && isComponentHovered === false && isLineHovered === false)

	// The line should still be highlighted when the checkpoint is checked out
	const shouldShowHoveredLine = isCheckpointCheckedOut || isLineHovered || isComponentHovered || showRestoreConfirm

	// Debounce time for hiding the ExpandedUI
	const checkpointHoverDebounce: number = 400

	return (
		<Container isMenuOpen={showRestoreConfirm} $isCheckedOut={isCheckpointCheckedOut}>
			{/* Line indicator is still styled differently for checked out checkpoints */}
			<CheckpointIndicator
				$isCheckedOut={isCheckpointCheckedOut}
				$isHovered={shouldShowHoveredLine}
				onMouseEnter={() => setIsLineHovered(true)}
				onMouseLeave={handleIndicatorMouseLeave}
			/>

			<HoverArea onMouseEnter={() => setIsLineHovered(true)} onMouseLeave={handleIndicatorMouseLeave} />

			{showExpandedUI && (
				<ExpandedUI
					$isCheckedOut={isCheckpointCheckedOut}
					$isLastRow={isLastRow}
					onMouseEnter={() => {
						if (hideTimerRef.current) {
							clearTimeout(hideTimerRef.current)
							hideTimerRef.current = null
						}
						setIsComponentHovered(true)
						setIsLineHovered(true)
					}}
					onMouseLeave={(e) => {
						if (!showRestoreConfirm) {
							handleDebounceMouseLeave()
						} else {
							handleControlsMouseLeave(e)
						}
					}}>
					<SimpleLayout>
						<LabelColumn>
							<div style={{ display: "flex", alignItems: "center" }}>
								<i
									className="codicon codicon-bookmark"
									style={{
										color: isCheckpointCheckedOut
											? "var(--vscode-textLink-foreground)"
											: "var(--vscode-descriptionForeground)",
										fontSize: "12px",
										marginRight: "6px",
									}}
								/>
								<Label $isCheckedOut={isCheckpointCheckedOut}>
									{isCheckpointCheckedOut ? "Checkpoint (restored)" : "Checkpoint"}
								</Label>
							</div>

							<TimeLabel $isCheckedOut={isCheckpointCheckedOut}>{combinedTimeFormat}</TimeLabel>
						</LabelColumn>

						<ButtonsWrapper>
							<EnhancedButton
								$isCheckedOut={isCheckpointCheckedOut}
								disabled={compareDisabled}
								style={{ cursor: compareDisabled ? "wait" : "pointer" }}
								onClick={() => {
									setCompareDisabled(true)
									vscode.postMessage({
										type: "checkpointDiff",
										number: messageTs,
									})
								}}>
								Compare
							</EnhancedButton>

							<div ref={refs.setReference} style={{ position: "relative" }}>
								<EnhancedButton
									$isCheckedOut={isCheckpointCheckedOut}
									isActive={showRestoreConfirm}
									onClick={() => setShowRestoreConfirm(true)}>
									Restore
								</EnhancedButton>
								{showRestoreConfirm &&
									createPortal(
										<RestoreConfirmTooltip
											ref={refs.setFloating}
											style={floatingStyles}
											data-placement={placement}
											onMouseEnter={handleMouseEnter}
											onMouseLeave={handleMouseLeave}>
											<RestoreOption>
												<VSCodeButton
													onClick={handleRestoreWorkspace}
													disabled={restoreWorkspaceDisabled}
													style={{
														cursor: restoreWorkspaceDisabled ? "wait" : "pointer",
														width: "100%",
														marginBottom: "10px",
													}}>
													Restore Files
												</VSCodeButton>
												<p>
													Restores your project's files back to a snapshot taken at this point (use
													"Compare" to see what will be reverted)
												</p>
											</RestoreOption>
											<RestoreOption>
												<VSCodeButton
													onClick={handleRestoreTask}
													disabled={restoreTaskDisabled}
													style={{
														cursor: restoreTaskDisabled ? "wait" : "pointer",
														width: "100%",
														marginBottom: "10px",
													}}>
													Restore Task Only
												</VSCodeButton>
												<p>Deletes messages after this point (does not affect workspace files)</p>
											</RestoreOption>
											<RestoreOption>
												<VSCodeButton
													onClick={handleRestoreBoth}
													disabled={restoreBothDisabled}
													style={{
														cursor: restoreBothDisabled ? "wait" : "pointer",
														width: "100%",
														marginBottom: "10px",
													}}>
													Restore Files & Task
												</VSCodeButton>
												<p>Restores your project's files and deletes all messages after this point</p>
											</RestoreOption>
										</RestoreConfirmTooltip>,
										document.body,
									)}
							</div>
						</ButtonsWrapper>
					</SimpleLayout>
				</ExpandedUI>
			)}
		</Container>
	)
}

// Updated Container styling - doesn't need to handle as many hover events
const Container = styled.div<{
	isMenuOpen?: boolean
	$isCheckedOut?: boolean
}>`
	position: absolute;
	left: 0;
	right: 0;
	top: 0;
	height: 0;
	z-index: 10;
	pointer-events: auto;
`

// Invisible hover area just around the line indicator
const HoverArea = styled.div`
	position: absolute;
	left: 0;
	top: -6px;
	width: 20px; /* Wide enough to easily hover */
	height: 15px; /* Tall enough to catch hover events */
	cursor: pointer;
`

// Make the highlighted line more visible for checked out checkpoints
const CheckpointIndicator = styled.div<{
	$isCheckedOut?: boolean
	$isHovered?: boolean
}>`
	position: absolute;
	left: 0;
	top: 0;
	/* Make checked out checkpoints have a more visible line */
	width: ${(props) =>
		props.$isCheckedOut ? "10px" /* Wider default for checked out checkpoints */ : props.$isHovered ? "13px" : "10px"};
	height: 6px;
	background-color: ${(props) =>
		props.$isCheckedOut ? "var(--vscode-textLink-foreground)" : "var(--vscode-descriptionForeground)"};
	opacity: ${(props) => (props.$isCheckedOut ? 1 /* Always full opacity for checked out */ : props.$isHovered ? 1 : 0.6)};
	transition:
		opacity 0.15s ease-in-out,
		width 0.15s ease-in-out;
	cursor: pointer;
	border-top-right-radius: 3px;
	border-bottom-right-radius: 3px;
	z-index: 5;
`

// Added label column component for consistent height
const LabelColumn = styled.div`
	display: flex;
	flex-direction: column;
	justify-content: center;
`

// Updated SimpleLayout with center alignment
const SimpleLayout = styled.div`
	display: flex;
	justify-content: space-between;
	align-items: center; /* Center align items vertically */
	width: 100%;
`

// Updated ButtonsWrapper with center alignment
const ButtonsWrapper = styled.div`
	display: flex;
	flex-wrap: wrap;
	gap: 6px; /* Reduced gap */
	justify-content: flex-end;
	align-items: center;
`

// Container for the expanded UI that appears on hover
const ExpandedUI = styled.div<{
	$isCheckedOut?: boolean
	$isLastRow?: boolean
}>`
	position: absolute;
	left: 15px;
	right: 7px;
	${
		(props) =>
			props.$isLastRow
				? "bottom: -3px;" // Position above for last row
				: "top: -3px;" // Position below for normal rows
	}
	background-color: var(--vscode-editor-background);
	border-radius: 3px;
	padding: 10px;
	box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
	border: 1px solid var(--vscode-widget-border);
	z-index: 20;
	animation: ${(props) => (props.$isLastRow ? "fadeInUp" : "fadeIn")} 0.15s ease-in-out;

	@keyframes fadeIn {
		from {
			opacity: 0;
			transform: translateY(-5px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@keyframes fadeInUp {
		from {
			opacity: 0;
			transform: translateY(5px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
`

// Updated Label with slightly smaller font size
const Label = styled.span<{ $isCheckedOut?: boolean }>`
	color: ${(props) => (props.$isCheckedOut ? "var(--vscode-textLink-foreground)" : "var(--vscode-descriptionForeground)")};
	font-size: 11px; // Reduced from 12px
	font-weight: 500;
	flex-shrink: 0;
`

// Updated TimeLabel with word-break enabled
const TimeLabel = styled.span<{ $isCheckedOut?: boolean }>`
	font-size: 10px;
	color: ${(props) => (props.$isCheckedOut ? "var(--vscode-textLink-foreground)" : "var(--vscode-descriptionForeground)")};
	margin-top: 3px;
	margin-left: 20px;
	word-break: break-word; /* Allow breaking words */
	white-space: normal; /* Changed from nowrap to allow text to wrap */
	max-width: 100%;
	display: block; /* Ensure it takes full width for proper breaking */
`

// Simplified button styling with minimal padding and no extra styling
const EnhancedButton = styled.button<{
	disabled?: boolean
	isActive?: boolean
	$isCheckedOut?: boolean
}>`
	background: ${(props) =>
		props.isActive || props.disabled
			? props.$isCheckedOut
				? "var(--vscode-textLink-foreground)"
				: "var(--vscode-descriptionForeground)"
			: "var(--vscode-editor-background)"};
	border: 1px solid
		${(props) => (props.$isCheckedOut ? "var(--vscode-textLink-foreground)" : "var(--vscode-descriptionForeground)")};
	color: ${(props) =>
		props.isActive || props.disabled
			? "var(--vscode-editor-background)"
			: props.$isCheckedOut
				? "var(--vscode-textLink-foreground)"
				: "var(--vscode-descriptionForeground)"};
	border-radius: 3px;
	padding: 3px 4px; /* Minimal padding */
	font-size: 10px;
	cursor: ${(props) => (props.disabled ? "wait" : "pointer")};
	line-height: 1;
	height: auto;
	margin: 0;

	&:hover:not(:disabled) {
		background: ${(props) =>
			props.$isCheckedOut ? "var(--vscode-textLink-foreground)" : "var(--vscode-descriptionForeground)"};
		color: var(--vscode-editor-background);
	}

	&:disabled {
		opacity: 0.6;
	}
`

const RestoreOption = styled.div`
	&:not(:last-child) {
		margin-bottom: 10px;
		padding-bottom: 4px;
		border-bottom: 1px solid var(--vscode-editorGroup-border);
	}

	p {
		margin: 0 0 2px 0;
		color: var(--vscode-descriptionForeground);
		font-size: 11px;
		line-height: 14px;
	}

	&:last-child p {
		margin: 0 0 -2px 0;
	}
`

const RestoreConfirmTooltip = styled.div`
	position: fixed;
	background: ${CODE_BLOCK_BG_COLOR};
	border: 1px solid var(--vscode-editorGroup-border);
	padding: 12px;
	border-radius: 3px;
	width: min(calc(100vw - 54px), 600px);
	z-index: 1000;

	// Add invisible padding to create a safe hover zone
	&::before {
		content: "";
		position: absolute;
		top: -8px;
		left: 0;
		right: 0;
		height: 8px;
	}

	// Adjust arrow to be above the padding
	&::after {
		content: "";
		position: absolute;
		top: -6px;
		right: 24px;
		width: 10px;
		height: 10px;
		background: ${CODE_BLOCK_BG_COLOR};
		border-left: 1px solid var(--vscode-editorGroup-border);
		border-top: 1px solid var(--vscode-editorGroup-border);
		transform: rotate(45deg);
		z-index: 1;
	}

	// When menu appears above the button
	&[data-placement^="top"] {
		&::before {
			top: auto;
			bottom: -8px;
		}

		&::after {
			top: auto;
			bottom: -6px;
			right: 24px;
			transform: rotate(225deg);
		}
	}

	p {
		margin: 0 0 6px 0;
		color: var(--vscode-descriptionForeground);
		font-size: 12px;
		white-space: normal;
		word-wrap: break-word;
	}
`
