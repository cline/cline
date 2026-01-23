/**
 * Task view component
 * Main view for running a task - displays messages and handles user input
 */

import { exit } from "node:process"
import { CheckpointRestoreRequest } from "@shared/proto/cline/checkpoints"
import { Box, Text, useInput } from "ink"
import React, { useCallback, useEffect, useMemo, useState } from "react"
import { checkpointRestore } from "@/core/controller/checkpoints/checkpointRestore"
import { StateManager } from "@/core/storage/StateManager"
import { useStdinContext } from "../context/StdinContext"
import { useTaskContext, useTaskState } from "../context/TaskContext"
import { useCompletionSignals, useIsSpinnerActive } from "../hooks/useStateSubscriber"
import { AskPrompt } from "./AskPrompt"
import { CheckpointMenu, RestoreType } from "./CheckpointMenu"
import { FocusChain } from "./FocusChain"
import { MessageList } from "./MessageList"
import { LoadingSpinner } from "./Spinner"

interface TaskViewProps {
	taskId?: string
	verbose?: boolean
	onComplete?: () => void
	onError?: () => void
}

/**
 * Format separator line
 */
function formatSeparator(char: string = "═", width: number = 60): string {
	return char.repeat(Math.max(width, 10))
}

export const TaskView: React.FC<TaskViewProps> = ({ taskId: _taskId, verbose = false, onComplete, onError }) => {
	const { isRawModeSupported } = useStdinContext()
	const state = useTaskState()
	const { isTaskComplete, getCompletionMessage } = useCompletionSignals()
	const isSpinnerActive = useIsSpinnerActive()
	const { setIsComplete, lastError, controller } = useTaskContext()
	const [showCheckpointMenu, setShowCheckpointMenu] = useState(false)
	const [restoreStatus, setRestoreStatus] = useState<"idle" | "restoring" | "success" | "error">("idle")
	const [restoreMessage, setRestoreMessage] = useState<string | null>(null)

	const yolo = useMemo(() => StateManager.get().getGlobalSettingsKey("yoloModeToggled"), [])

	// Handle task completion
	useEffect(() => {
		if (isTaskComplete()) {
			setIsComplete(true)

			// Check if it's an error
			const completionMsg = getCompletionMessage()
			if (completionMsg?.say === "error" || completionMsg?.ask === "api_req_failed") {
				onError?.()
			} else {
				onComplete?.()
			}

			if (yolo) {
				exit()
			}
		}
	}, [isTaskComplete, setIsComplete, onComplete, onError, getCompletionMessage])

	// Handle checkpoint restore
	const handleCheckpointRestore = useCallback(
		async (messageTs: number, restoreType: RestoreType) => {
			setShowCheckpointMenu(false)
			setRestoreStatus("restoring")
			setRestoreMessage(`Restoring checkpoint (${restoreType})...`)

			try {
				await checkpointRestore(
					controller,
					CheckpointRestoreRequest.create({
						number: messageTs,
						restoreType: restoreType,
					}),
				)
				setRestoreStatus("success")
				setRestoreMessage("Checkpoint restored successfully")
				// Clear success message after a delay
				setTimeout(() => {
					setRestoreStatus("idle")
					setRestoreMessage(null)
				}, 3000)
			} catch (error) {
				setRestoreStatus("error")
				setRestoreMessage(`Failed to restore: ${error instanceof Error ? error.message : String(error)}`)
				// Clear error message after a delay
				setTimeout(() => {
					setRestoreStatus("idle")
					setRestoreMessage(null)
				}, 5000)
			}
		},
		[controller],
	)

	// Handle Ctrl+R to open checkpoint menu
	useInput(
		(input, key) => {
			// Ctrl+R to open checkpoint menu
			if (key.ctrl && input === "r") {
				setShowCheckpointMenu(true)
				return
			}
		},
		{ isActive: isRawModeSupported && !showCheckpointMenu },
	)

	return (
		<Box flexDirection="column">
			{/* Task header */}
			{state.currentTaskItem && (
				<Box flexDirection="column" marginBottom={1}>
					<Text>{formatSeparator("═")}</Text>
					<Text bold color="white">
						📋 Task: {state.currentTaskItem.id}
					</Text>
					{state.currentTaskItem.task && (
						<Text dimColor>
							{state.currentTaskItem.task.substring(0, 80)}
							{state.currentTaskItem.task.length > 80 ? "..." : ""}
						</Text>
					)}
					<Box>
						<Text>{formatSeparator("═")}</Text>
					</Box>
					<Text color="gray" dimColor>
						(Ctrl+R to restore checkpoint)
					</Text>
				</Box>
			)}

			{/* Error message if any */}
			{lastError && (
				<Box flexDirection="column" marginBottom={1}>
					<Text bold color="red">
						Error: {lastError}
					</Text>
				</Box>
			)}

			{/* Restore status message */}
			{restoreMessage && (
				<Box flexDirection="column" marginBottom={1}>
					<Text bold color={restoreStatus === "error" ? "red" : restoreStatus === "success" ? "green" : "yellow"}>
						{restoreStatus === "restoring" ? "⏳ " : restoreStatus === "success" ? "✓ " : "✗ "}
						{restoreMessage}
					</Text>
				</Box>
			)}

			{/* Checkpoint menu */}
			{showCheckpointMenu && (
				<CheckpointMenu
					messages={state.clineMessages || []}
					onCancel={() => setShowCheckpointMenu(false)}
					onSelect={handleCheckpointRestore}
				/>
			)}

			{/* Focus Chain / To-Do List */}
			{state.currentFocusChainChecklist && (
				<Box marginBottom={1}>
					<FocusChain focusChainChecklist={state.currentFocusChainChecklist} />
				</Box>
			)}

			{/* Messages list */}
			<MessageList verbose={verbose} />

			{/* Loading spinner */}
			{isSpinnerActive && (
				<Box marginTop={1}>
					<LoadingSpinner />
				</Box>
			)}

			{/* User input prompt */}
			{!yolo && <AskPrompt />}
		</Box>
	)
}
