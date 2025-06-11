import { CODE_BLOCK_BG_COLOR } from "@/components/common/CodeBlock"
import { CheckpointsServiceClient } from "@/services/grpc-client"
import { flip, offset, shift, useFloating } from "@floating-ui/react"
import { CheckpointRestoreRequest } from "@shared/proto/checkpoints"
import { Int64Request } from "@shared/proto/common"
import { ClineCheckpointRestore } from "@shared/WebviewMessage"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import styled from "styled-components"
import { useExtensionState } from "@/context/ExtensionStateContext"

interface CheckmarkControlProps {
	messageTs?: number
	isCheckpointCheckedOut?: boolean
}

export const CheckmarkControl = ({ messageTs, isCheckpointCheckedOut }: CheckmarkControlProps) => {
	const [compareDisabled, setCompareDisabled] = useState(false)
	const [restoreTaskDisabled, setRestoreTaskDisabled] = useState(false)
	const [restoreWorkspaceDisabled, setRestoreWorkspaceDisabled] = useState(false)
	const [restoreBothDisabled, setRestoreBothDisabled] = useState(false)
	const [showRestoreConfirm, setShowRestoreConfirm] = useState(false)
	const [hasMouseEntered, setHasMouseEntered] = useState(false)
	const containerRef = useRef<HTMLDivElement>(null)
	const tooltipRef = useRef<HTMLDivElement>(null)
	const { onRelinquishControl } = useExtensionState()

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

	// Use the onRelinquishControl hook instead of message event
	useEffect(() => {
		return onRelinquishControl(() => {
			setCompareDisabled(false)
			setRestoreTaskDisabled(false)
			setRestoreWorkspaceDisabled(false)
			setRestoreBothDisabled(false)
			setShowRestoreConfirm(false)
		})
	}, [onRelinquishControl])

	const handleRestoreTask = async () => {
		setRestoreTaskDisabled(true)
		try {
			const restoreType: ClineCheckpointRestore = "task"
			await CheckpointsServiceClient.checkpointRestore(
				CheckpointRestoreRequest.create({
					number: messageTs,
					restoreType,
				}),
			)
		} catch (err) {
			console.error("Checkpoint restore task error:", err)
			setRestoreTaskDisabled(false)
		}
	}

	const handleRestoreWorkspace = async () => {
		setRestoreWorkspaceDisabled(true)
		try {
			const restoreType: ClineCheckpointRestore = "workspace"
			await CheckpointsServiceClient.checkpointRestore(
				CheckpointRestoreRequest.create({
					number: messageTs,
					restoreType,
				}),
			)
		} catch (err) {
			console.error("Checkpoint restore workspace error:", err)
			setRestoreWorkspaceDisabled(false)
		}
	}

	const handleRestoreBoth = async () => {
		setRestoreBothDisabled(true)
		try {
			const restoreType: ClineCheckpointRestore = "taskAndWorkspace"
			await CheckpointsServiceClient.checkpointRestore(
				CheckpointRestoreRequest.create({
					number: messageTs,
					restoreType,
				}),
			)
		} catch (err) {
			console.error("Checkpoint restore both error:", err)
			setRestoreBothDisabled(false)
		}
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

	return (
		<Container isMenuOpen={showRestoreConfirm} $isCheckedOut={isCheckpointCheckedOut} onMouseLeave={handleControlsMouseLeave}>
			<i
				className="codicon codicon-bookmark"
				style={{
					color: isCheckpointCheckedOut ? "var(--vscode-textLink-foreground)" : "var(--vscode-descriptionForeground)",
					fontSize: "12px",
					flexShrink: 0,
				}}
			/>
			<Label $isCheckedOut={isCheckpointCheckedOut}>
				{isCheckpointCheckedOut ? "Checkpoint (restored)" : "Checkpoint"}
			</Label>
			<DottedLine $isCheckedOut={isCheckpointCheckedOut} />
			<ButtonGroup>
				<CustomButton
					$isCheckedOut={isCheckpointCheckedOut}
					disabled={compareDisabled}
					style={{ cursor: compareDisabled ? "wait" : "pointer" }}
					onClick={async () => {
						setCompareDisabled(true)
						try {
							await CheckpointsServiceClient.checkpointDiff(
								Int64Request.create({
									value: messageTs,
								}),
							)
						} catch (err) {
							console.error("CheckpointDiff error:", err)
						} finally {
							setCompareDisabled(false)
						}
					}}>
					Compare
				</CustomButton>
				<DottedLine small $isCheckedOut={isCheckpointCheckedOut} />
				<div ref={refs.setReference} style={{ position: "relative", marginTop: -2 }}>
					<CustomButton
						$isCheckedOut={isCheckpointCheckedOut}
						isActive={showRestoreConfirm}
						onClick={() => setShowRestoreConfirm(true)}>
						Restore
					</CustomButton>
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
										Restores your project's files back to a snapshot taken at this point (use "Compare" to see
										what will be reverted)
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
				<DottedLine small $isCheckedOut={isCheckpointCheckedOut} />
			</ButtonGroup>
		</Container>
	)
}

const Container = styled.div<{ isMenuOpen?: boolean; $isCheckedOut?: boolean }>`
	display: flex;
	align-items: center;
	padding: 4px 0;
	gap: 4px;
	position: relative;
	min-width: 0;
	margin-top: -10px;
	margin-bottom: -10px;
	opacity: ${(props) => (props.$isCheckedOut ? 1 : props.isMenuOpen ? 1 : 0.5)};

	&:hover {
		opacity: 1;
	}
`

const Label = styled.span<{ $isCheckedOut?: boolean }>`
	color: ${(props) => (props.$isCheckedOut ? "var(--vscode-textLink-foreground)" : "var(--vscode-descriptionForeground)")};
	font-size: 9px;
	flex-shrink: 0;
`

const DottedLine = styled.div<{ small?: boolean; $isCheckedOut?: boolean }>`
	flex: ${(props) => (props.small ? "0 0 5px" : "1")};
	min-width: ${(props) => (props.small ? "5px" : "5px")};
	height: 1px;
	background-image: linear-gradient(
		to right,
		${(props) => (props.$isCheckedOut ? "var(--vscode-textLink-foreground)" : "var(--vscode-descriptionForeground)")} 50%,
		transparent 50%
	);
	background-size: 4px 1px;
	background-repeat: repeat-x;
`

const ButtonGroup = styled.div`
	display: flex;
	align-items: center;
	gap: 4px;
	flex-shrink: 0;
`

const CustomButton = styled.button<{ disabled?: boolean; isActive?: boolean; $isCheckedOut?: boolean }>`
	background: ${(props) =>
		props.isActive || props.disabled
			? props.$isCheckedOut
				? "var(--vscode-textLink-foreground)"
				: "var(--vscode-descriptionForeground)"
			: "transparent"};
	border: none;
	color: ${(props) =>
		props.isActive || props.disabled
			? "var(--vscode-editor-background)"
			: props.$isCheckedOut
				? "var(--vscode-textLink-foreground)"
				: "var(--vscode-descriptionForeground)"};
	padding: 2px 6px;
	font-size: 9px;
	cursor: pointer;
	position: relative;

	&::before {
		content: "";
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		border-radius: 1px;
		background-image: ${(props) =>
			props.isActive || props.disabled
				? "none"
				: `linear-gradient(to right, ${props.$isCheckedOut ? "var(--vscode-textLink-foreground)" : "var(--vscode-descriptionForeground)"} 50%, transparent 50%),
			linear-gradient(to bottom, ${props.$isCheckedOut ? "var(--vscode-textLink-foreground)" : "var(--vscode-descriptionForeground)"} 50%, transparent 50%),
			linear-gradient(to right, ${props.$isCheckedOut ? "var(--vscode-textLink-foreground)" : "var(--vscode-descriptionForeground)"} 50%, transparent 50%),
			linear-gradient(to bottom, ${props.$isCheckedOut ? "var(--vscode-textLink-foreground)" : "var(--vscode-descriptionForeground)"} 50%, transparent 50%)`};
		background-size: ${(props) => (props.isActive || props.disabled ? "auto" : `4px 1px, 1px 4px, 4px 1px, 1px 4px`)};
		background-repeat: repeat-x, repeat-y, repeat-x, repeat-y;
		background-position:
			0 0,
			100% 0,
			0 100%,
			0 0;
	}

	&:hover:not(:disabled) {
		background: ${(props) =>
			props.$isCheckedOut ? "var(--vscode-textLink-foreground)" : "var(--vscode-descriptionForeground)"};
		color: var(--vscode-editor-background);
		&::before {
			display: none;
		}
	}

	&:disabled {
		opacity: 0.5;
		cursor: not-allowed;
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
