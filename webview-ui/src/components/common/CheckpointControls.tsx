import { CheckpointRestoreRequest } from "@shared/proto/cline/checkpoints"
import { Int64Request } from "@shared/proto/cline/common"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useEffect, useRef, useState } from "react"
import { useClickAway } from "react-use"
import styled from "styled-components"
import { CODE_BLOCK_BG_COLOR } from "@/components/common/CodeBlock"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { CheckpointsServiceClient } from "@/services/grpc-client"

interface CheckpointOverlayProps {
	messageTs?: number
}

export const CheckpointOverlay = ({ messageTs }: CheckpointOverlayProps) => {
	const [compareDisabled, setCompareDisabled] = useState(false)
	const [restoreTaskDisabled, setRestoreTaskDisabled] = useState(false)
	const [restoreWorkspaceDisabled, setRestoreWorkspaceDisabled] = useState(false)
	const [restoreBothDisabled, setRestoreBothDisabled] = useState(false)
	const [showRestoreConfirm, setShowRestoreConfirm] = useState(false)
	const [hasMouseEntered, setHasMouseEntered] = useState(false)
	const containerRef = useRef<HTMLDivElement>(null)
	const tooltipRef = useRef<HTMLDivElement>(null)
	const { onRelinquishControl } = useExtensionState()

	useClickAway(containerRef, () => {
		if (showRestoreConfirm) {
			setShowRestoreConfirm(false)
			setHasMouseEntered(false)
		}
	})

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
			await CheckpointsServiceClient.checkpointRestore(
				CheckpointRestoreRequest.create({
					number: messageTs,
					restoreType: "task",
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
			await CheckpointsServiceClient.checkpointRestore(
				CheckpointRestoreRequest.create({
					number: messageTs,
					restoreType: "workspace",
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
			await CheckpointsServiceClient.checkpointRestore(
				CheckpointRestoreRequest.create({
					number: messageTs,
					restoreType: "taskAndWorkspace",
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

			// If mouse is moving towards the tooltip, don't close it
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
		<CheckpointControls onMouseLeave={handleControlsMouseLeave}>
			<VSCodeButton
				appearance="secondary"
				disabled={compareDisabled}
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
				}}
				style={{ cursor: compareDisabled ? "wait" : "pointer" }}
				title="Compare">
				<i className="codicon codicon-diff-multiple" style={{ position: "absolute" }} />
			</VSCodeButton>
			<div ref={containerRef} style={{ position: "relative" }}>
				<VSCodeButton
					appearance="secondary"
					onClick={() => setShowRestoreConfirm(true)}
					style={{ cursor: "pointer" }}
					title="Restore">
					<i className="codicon codicon-discard" style={{ position: "absolute" }} />
				</VSCodeButton>
				{showRestoreConfirm && (
					<RestoreConfirmTooltip onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave} ref={tooltipRef}>
						<RestoreOption>
							<VSCodeButton
								disabled={restoreBothDisabled}
								onClick={handleRestoreBoth}
								style={{
									cursor: restoreBothDisabled ? "wait" : "pointer",
								}}>
								Restore Task and Workspace
							</VSCodeButton>
							<p>Restores the task and your project's files back to a snapshot taken at this point</p>
						</RestoreOption>
						<RestoreOption>
							<VSCodeButton
								disabled={restoreTaskDisabled}
								onClick={handleRestoreTask}
								style={{
									cursor: restoreTaskDisabled ? "wait" : "pointer",
								}}>
								Restore Task Only
							</VSCodeButton>
							<p>Deletes messages after this point (does not affect workspace)</p>
						</RestoreOption>
						<RestoreOption>
							<VSCodeButton
								disabled={restoreWorkspaceDisabled}
								onClick={handleRestoreWorkspace}
								style={{
									cursor: restoreWorkspaceDisabled ? "wait" : "pointer",
								}}>
								Restore Workspace Only
							</VSCodeButton>
							<p>Restores your project's files to a snapshot taken at this point (task may become out of sync)</p>
						</RestoreOption>
					</RestoreConfirmTooltip>
				)}
			</div>
		</CheckpointControls>
	)
}

export const CheckpointControls = styled.div`
	position: absolute;
	top: 3px;
	right: 6px;
	display: flex;
	gap: 6px;
	opacity: 0;
	background-color: var(--vscode-sideBar-background);
	padding: 3px 0 3px 3px;

	& > vscode-button,
	& > div > vscode-button {
		width: 24px;
		height: 24px;
		position: relative;
	}

	& > vscode-button i,
	& > div > vscode-button i {
		position: absolute;
		left: 50%;
		top: 50%;
		transform: translate(-50%, -50%);
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

	vscode-button {
		width: 100%;
		margin-bottom: 10px;
	}
`

const RestoreConfirmTooltip = styled.div`
	position: absolute;
	top: calc(100% - 0.5px);
	right: 0;
	background: ${CODE_BLOCK_BG_COLOR};
	border: 1px solid var(--vscode-editorGroup-border);
	padding: 12px;
	border-radius: 3px;
	margin-top: 8px;
	width: calc(100vw - 57px);
	min-width: 0px;
	max-width: 100vw;
	z-index: 1000;

	// Add invisible padding to create a safe hover zone
	&::before {
		content: "";
		position: absolute;
		top: -8px; // Same as margin-top
		left: 0;
		right: 0;
		height: 8px;
	}

	// Adjust arrow to be above the padding
	&::after {
		content: "";
		position: absolute;
		top: -6px;
		right: 6px;
		width: 10px;
		height: 10px;
		background: ${CODE_BLOCK_BG_COLOR};
		border-left: 1px solid var(--vscode-editorGroup-border);
		border-top: 1px solid var(--vscode-editorGroup-border);
		transform: rotate(45deg);
		z-index: 1; // Ensure arrow stays above the padding
	}

	p {
		margin: 0 0 6px 0;
		color: var(--vscode-descriptionForeground);
		font-size: 12px;
		white-space: normal;
		word-wrap: break-word;
	}
`
