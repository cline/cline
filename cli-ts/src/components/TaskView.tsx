/**
 * Task view component
 * Main view for running a task - displays messages and handles user input
 */

import { Box, Text } from "ink"
import React, { useEffect } from "react"
import { useTaskContext, useTaskState } from "../context/TaskContext"
import { useCompletionSignals, useIsSpinnerActive } from "../hooks/useStateSubscriber"
import { AskPrompt } from "./AskPrompt"
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

export const TaskView: React.FC<TaskViewProps> = ({ taskId, verbose = false, onComplete, onError }) => {
	const state = useTaskState()
	const { isTaskComplete, getCompletionMessage } = useCompletionSignals()
	const isSpinnerActive = useIsSpinnerActive()
	const { setIsComplete, lastError } = useTaskContext()

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
		}
	}, [isTaskComplete, setIsComplete, onComplete, onError, getCompletionMessage])

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
					<Text>{formatSeparator("═")}</Text>
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
			<AskPrompt />
		</Box>
	)
}
